import { test, expect, type BrowserContext } from '@playwright/test'

// Isolated HTTP fixtures exercise browser cookie persistence, not a real account.
async function sessionServer(context: BrowserContext) {
  const state = { active: false, version: 0, concurrent: 0, maximum: 0, refreshes: 0 }
  const deadline = Date.now() + 7 * 86400_000
  const user = {
    id: 'session-fixture',
    displayName: 'Sessão de teste',
    email: 'session@example.invalid',
    role: 'user',
  }
  const cookie = () =>
    `cep-session-local=fixture-${state.version}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(deadline).toUTCString()}`
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/me')) return route.fulfill({ json: user })
    if (path.includes('/auth/web/'))
      expect(route.request().headers()['x-cep-web-session']).toBe('1')
    if (path.endsWith('/web/logout')) {
      state.active = false
      return route.fulfill({
        status: 204,
        headers: {
          'Set-Cookie': 'cep-session-local=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
        },
      })
    }
    if (path.endsWith('/web/refresh')) {
      state.refreshes++
      if (
        !state.active ||
        !route.request().headers().cookie?.includes(`cep-session-local=fixture-${state.version}`)
      )
        return route.fulfill({ status: 401, json: { code: 'session_expired' } })
      state.concurrent++
      state.maximum = Math.max(state.maximum, state.concurrent)
      await new Promise((resolve) => setTimeout(resolve, 120))
      state.concurrent--
    } else if (path.endsWith('/web/login')) state.active = true
    else throw new Error(`Unexpected fixture request: ${path}`)
    state.version++
    return route.fulfill({
      headers: { 'Set-Cookie': cookie() },
      json: {
        accessToken: `fixture-access-${state.version}`,
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        sessionExpiresAt: new Date(deadline).toISOString(),
        user,
      },
    })
  })
  return state
}

test('reload and a new tab retain login; HttpOnly cookie expires in seven days; logout clears all tabs', async ({
  page,
  context,
}) => {
  const server = await sessionServer(context)
  await page.goto('/')
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('session@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('fixture-only-password')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  await expect(page.getByRole('heading', { name: 'Olá, Sessão de teste.' })).toBeVisible()
  const cookies = await context.cookies()
  expect(cookies).toHaveLength(1)
  expect(cookies[0].httpOnly).toBe(true)
  expect(cookies[0].sameSite).toBe('Strict')
  expect(cookies[0].expires - Date.now() / 1000).toBeGreaterThan(6.99 * 86400)
  expect(
    await page.evaluate(() => [document.cookie, localStorage.length, sessionStorage.length]),
  ).toEqual(['', 0, 0])
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Olá, Sessão de teste.' })).toBeVisible()
  const other = await context.newPage()
  await Promise.all([page.reload(), other.goto('/')])
  for (const tab of [page, other])
    await expect(tab.getByRole('heading', { name: 'Olá, Sessão de teste.' })).toBeVisible()
  expect(server.maximum).toBe(1)
  expect(server.refreshes).toBe(4) // Initial anonymous check + reload + two concurrent tabs.
  await page.getByRole('button', { name: 'Sair da conta' }).click()
  for (const tab of [page, other])
    await expect(tab.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
  expect(await context.cookies()).toHaveLength(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
})

test('lost refresh response requires login without replay on another reload', async ({
  page,
  context,
}) => {
  await sessionServer(context)
  await page.goto('/')
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('session@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('fixture-only-password')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  await expect(page.getByRole('heading', { name: 'Olá, Sessão de teste.' })).toBeVisible()
  let attempts = 0
  await page.route('**/api/v1/auth/web/refresh', (route) => {
    attempts++
    return route.abort('connectionfailed')
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Não foi possível conectar')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
  expect(attempts).toBe(1)
})
