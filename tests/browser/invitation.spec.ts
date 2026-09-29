import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({ status: 401, json: { code: 'session_expired' } }),
  )
})

test('invitation link activates without tokens and returns to login', async ({ page }) => {
  let requests = 0
  await page.route('**/api/v1/auth/invitations/activate', async (route) => {
    requests++
    expect(route.request().postDataJSON()).toEqual({
      email: 'invite@example.test',
      code: '123456',
      displayName: 'Pessoa Teste',
      password: ' new password 123 ',
    })
    await route.fulfill({ status: 204 })
  })
  await page.goto('/?convite=1')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('E-mail do convite').fill('invite@example.test')
  await page.getByLabel('Seu nome').fill('Pessoa Teste')
  await page.getByLabel('Código do convite').fill('123456')
  await page.getByLabel('Crie sua senha').fill(' new password 123 ')
  await page.getByLabel('Confirme sua senha').fill('different password')
  await page.getByRole('button', { name: 'Ativar minha conta' }).click()
  await expect(page.getByRole('alert')).toContainText('não coincidem')
  expect(requests).toBe(0)
  await page.getByLabel('Confirme sua senha').fill(' new password 123 ')
  await page.getByRole('button', { name: 'Ativar minha conta' }).click()
  await expect(page.getByRole('heading', { name: 'Conta ativada' })).toBeVisible()
  expect(requests).toBe(1)
  await page.getByRole('button', { name: 'Voltar para entrar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page).not.toHaveURL(/convite=/)
})

test('login offers activation and explains invalid invitations', async ({ page }) => {
  await page.route('**/api/v1/auth/invitations/activate', (route) =>
    route.fulfill({
      status: 400,
      json: { code: 'invalid_invitation', correlationId: 'invite-test' },
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Recebi um convite' }).click()
  await page.getByLabel('E-mail do convite').fill('invite@example.test')
  await page.getByLabel('Seu nome').fill('Pessoa Teste')
  await page.getByLabel('Código do convite').fill('123456')
  await page.getByLabel('Crie sua senha').fill('new password 123')
  await page.getByLabel('Confirme sua senha').fill('new password 123')
  await page.getByRole('button', { name: 'Ativar minha conta' }).click()
  await expect(page.getByRole('alert')).toContainText('Convite inválido, expirado ou já utilizado')
  await expect(page.getByRole('alert')).toContainText('invite-test')
})
