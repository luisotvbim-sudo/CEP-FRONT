import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture } from './admin-fixture'
import { personalOverview } from '../../src/user/overview-fixture'

for (const [status, title] of [
  ['regular', 'Dentro da tolerância neste corte'],
  ['difference', 'Há diferenças para conferir'],
  ['incomplete', 'Ainda faltam informações'],
  ['notAssociated', 'Sua associação precisa ser conferida'],
  ['inactiveIdentity', 'Um cadastro de origem está inativo'],
] as const) {
  test(`personal overview ${status} has one heading and accessible progressive detail`, async ({
    page,
  }) => {
    const calls = await fixture(page, { role: 'user', overviewStatus: status })
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.getByText('ADMINISTRAÇÃO', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/Conferido até/)).toBeVisible()
    expect(calls.filter((call) => call.path.includes('/overview')).length).toBe(1)
    if (status === 'incomplete') {
      await expect(page.locator('.overview-metrics').getByText('Indisponível')).toHaveCount(3)
      await page.getByText('Ver detalhes e qualidade das fontes').focus()
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('heading', { name: 'Valores disponíveis por fonte' }),
      ).toBeVisible()
    }
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([])
    await page.getByRole('button', { name: 'Consultar meu histórico' }).click()
    await expect(page.getByRole('heading', { name: 'Meu histórico' })).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
  })
}

test('failed refresh preserves previous cutoff and does not expose source internals', async ({
  page,
}) => {
  await fixture(page, { role: 'user' })
  await expect(
    page.getByRole('heading', { name: 'Dentro da tolerância neste corte' }),
  ).toBeVisible()
  await page.route('**/me/time-control/overview?**', (route) =>
    route.fulfill({ status: 503, json: { code: 'private_secret_diagnostic' } }),
  )
  await page.getByRole('button', { name: 'Conferir agora' }).click()
  await expect(page.getByRole('alert')).toContainText('conferência anterior')
  await expect(page.getByText('private_secret_diagnostic')).toHaveCount(0)
  await page.route('**/me/time-control/overview?**', (route) =>
    route.fulfill({ json: personalOverview('difference') }),
  )
  await page.getByRole('button', { name: 'Conferir agora' }).click()
  await expect(page.getByRole('heading', { name: 'Há diferenças para conferir' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('older API and retry-after have explicit recovery without polling', async ({ page }) => {
  await fixture(page, { role: 'user' })
  await expect(
    page.getByRole('heading', { name: 'Dentro da tolerância neste corte' }),
  ).toBeVisible()
  await page.route('**/me/time-control/overview?**', (route) =>
    route.fulfill({ status: 404, json: {} }),
  )
  await page.getByRole('button', { name: 'Conferir agora' }).click()
  await expect(page.getByRole('alert')).toContainText('ainda não oferece')
  let calls = 0
  await page.route('**/me/time-control/overview?**', (route) => {
    calls++
    return route.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: {} })
  })
  await page.getByRole('button', { name: 'Conferir agora' }).click()
  await expect(page.getByRole('alert')).toContainText('Aguarde antes')
  await expect(page.getByRole('button', { name: 'Conferir agora' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Conferir agora' })).toBeEnabled()
  expect(calls).toBe(1)
})

test('rapid period selection reads only the last choice and logout removes personal data', async ({
  page,
}) => {
  const calls = await fixture(page, { role: 'user' })
  await expect(
    page.getByRole('heading', { name: 'Dentro da tolerância neste corte' }),
  ).toBeVisible()
  await page.getByLabel('Período oficial').selectOption('weekly')
  await page.getByLabel('Período oficial').selectOption('sprint')
  await expect
    .poll(() => calls.filter((call) => call.path.includes('overview?period=sprint')).length)
    .toBe(1)
  expect(calls.filter((call) => call.path.includes('overview?period=weekly'))).toHaveLength(0)
  await page.getByRole('button', { name: 'Sair da conta' }).click()
  await expect(page.getByRole('button', { name: 'Entrar na minha conta' })).toBeVisible()
  await expect(page.getByText('Dentro da tolerância neste corte')).toHaveCount(0)
})

test('personal overview fits 360 pixels and produces synthetic review captures', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({
    width: testInfo.project.name === 'desktop' ? 1440 : 360,
    height: 1000,
  })
  await fixture(page, { role: 'user', overviewStatus: 'difference' })
  await expect(page.getByRole('heading', { name: 'Há diferenças para conferir' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({
    path: testInfo.outputPath('acompanhamento-sintetico.png'),
    fullPage: true,
  })
})
