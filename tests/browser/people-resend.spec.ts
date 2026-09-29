import { test, expect } from '@playwright/test'
import { fixture, ids, person } from './admin-fixture'

test('pending unexpired invitation can be resent only after confirmation', async ({ page }) => {
  await fixture(page)
  let sends = 0
  await page.route('**/organization/invitations/*/resend', async (route) => {
    sends++
    expect(route.request().method()).toBe('POST')
    expect(new URL(route.request().url()).pathname).toBe(
      `/api/v1/organization/invitations/${ids.invitation}/resend`,
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({ status: 204 })
  })
  await expect(page.getByText('Aguardando aceite', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reenviar convite', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Confirmar reenvio do convite' })).toContainText(
    'link',
  )
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  expect(sends).toBe(0)
  await page.getByRole('button', { name: 'Reenviar convite', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar reenvio' }).click()
  await expect(page.getByRole('button', { name: 'Reenviando…' })).toBeDisabled()
  await expect(page.getByRole('status').filter({ hasText: 'fila de envio' })).toContainText(
    'não confirma a entrega',
  )
  expect(sends).toBe(1)
})

test('accepted account and missing invitation state do not offer resend', async ({ page }) => {
  await fixture(page)
  await page.route('**/time-control/people?*', (route) =>
    route.fulfill({
      json: {
        items: [{ ...person, userId: ids.user }],
        total: 1,
        page: 1,
        pageSize: 12,
      },
    }),
  )
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await expect(page.getByText('Aceito', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reenviar convite', exact: true })).toHaveCount(0)
  await page.route('**/time-control/people?*', (route) =>
    route.fulfill({ json: { items: [person], total: 1, page: 1, pageSize: 12 } }),
  )
  await page.route('**/organization/invitations', (route) => route.fulfill({ json: [] }))
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await expect(page.getByText('Aceite não registrado', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reenviar convite', exact: true })).toHaveCount(0)
})
