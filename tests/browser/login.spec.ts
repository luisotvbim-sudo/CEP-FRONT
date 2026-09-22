import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({ status: 401, json: { code: 'session_expired' } }),
  )
})

test('responsive login, keyboard and password visibility', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
  await expect(page.getByAltText('Conceito Engenharia')).toBeVisible()
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('test@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('not-a-real-password')
  await page.getByRole('button', { name: 'Mostrar senha' }).click()
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Ocultar senha' }).click()
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'password')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('')
  await page.getByLabel('Senha', { exact: true }).fill('')
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).click()
  await page.screenshot({ path: `.local/login-${testInfo.project.name}.png`, fullPage: true })
})

test('submits once, shows the API error and preserves the support code', async ({ page }) => {
  let requests = 0
  await page.route('**/api/v1/auth/web/login', async (route) => {
    requests++
    await new Promise((resolve) => setTimeout(resolve, 350))
    await route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({ code: 'invalid_credentials', correlationId: 'trace-example' }),
    })
  })
  await page.goto('/')
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('test@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('invalid-password')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  await expect(page.getByRole('button', { name: 'Entrando' })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha inválidos')
  await expect(page.getByRole('alert')).toContainText('trace-example')
  expect(requests).toBe(1)
})

test('authenticated state uses backend identity, logs out and stores no credentials', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/web/login', (route) =>
    route.fulfill({
      json: {
        accessToken: 'test-access',
        sessionExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        user: {
          id: 'test',
          displayName: 'Pessoa de teste',
          email: 'test@example.invalid',
          role: 'user',
        },
      },
    }),
  )
  let loggedOut = false
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        id: 'test',
        displayName: 'Pessoa de teste',
        email: 'test@example.invalid',
        role: 'user',
      },
    }),
  )
  await page.route('**/api/v1/auth/web/logout', (route) => {
    expect(route.request().postDataJSON()).toEqual({})
    loggedOut = true
    return route.fulfill({ status: 204 })
  })
  await page.goto('/')
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('test@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('test-password')
  await page.getByLabel('Senha', { exact: true }).press('Enter')
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa de teste.' })).toBeVisible()
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
  await page.getByRole('button', { name: 'Sair da conta' }).click()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
  expect(loggedOut).toBe(true)
})

test('password recovery calls the API and returns focus to the login', async ({ page }) => {
  await page.route('**/api/v1/auth/password/forgot', (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: 'test@example.invalid' })
    return route.fulfill({ status: 202 })
  })
  await page.route('**/api/v1/auth/password/reset', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'test@example.invalid',
      code: 'example-code',
      newPassword: 'Example-password-123',
    })
    return route.fulfill({ status: 204 })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click()
  await page.getByRole('dialog').getByLabel('E-mail corporativo').fill('test@example.invalid')
  await page.getByRole('button', { name: 'Enviar instruções' }).click()
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible()
  await page.getByLabel('Código recebido por e-mail').fill('example-code')
  await page.getByLabel('Nova senha', { exact: true }).fill('Example-password-123')
  await page.getByLabel('Confirme a nova senha').fill('Example-password-123')
  await page.getByRole('button', { name: 'Salvar nova senha' }).click()
  await expect(page.getByRole('heading', { name: 'Senha atualizada' })).toBeVisible()
  await page.getByRole('button', { name: 'Voltar para o login' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('network failure stays recoverable and does not expose internal errors', async ({ page }) => {
  await page.route('**/api/v1/auth/web/login', (route) => route.abort('connectionfailed'))
  await page.goto('/')
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('test@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  await expect(page.getByRole('alert')).toContainText('Não foi possível conectar')
  await expect(page.getByRole('button', { name: 'Entrar na minha conta' })).toBeEnabled()
})

test('same interface uses native bridge inside WebView2', async ({ page }) => {
  await page.addInitScript(() => {
    window.__CEP_DESKTOP__ = true
    const listeners = new Set<(event: { data: object }) => void>()
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        webview: {
          addEventListener: (_type: string, fn: (event: { data: object }) => void) =>
            listeners.add(fn),
          removeEventListener: (_type: string, fn: (event: { data: object }) => void) =>
            listeners.delete(fn),
          postMessage: (message: { id: string; operation: string }) => {
            queueMicrotask(() =>
              listeners.forEach((listener) =>
                listener({
                  data: {
                    id: message.id,
                    ok: true,
                    result:
                      message.operation === 'login'
                        ? {
                            user: {
                              id: 'native-test',
                              displayName: 'Usuário desktop',
                              email: 'desktop@example.invalid',
                            },
                            expiresAt: new Date(Date.now() + 60_000).toISOString(),
                          }
                        : null,
                  },
                }),
              ),
            )
          },
        },
      },
    })
  })
  await page.route('**/api/**', () => {
    throw new Error('Desktop must not call HTTP from React')
  })
  await page.goto('/')
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('desktop@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  await expect(page.getByRole('heading', { name: 'Olá, Usuário desktop.' })).toBeVisible()
  await page.getByRole('button', { name: 'Sair da conta' }).click()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
})
