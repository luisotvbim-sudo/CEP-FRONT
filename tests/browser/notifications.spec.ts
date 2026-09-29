import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture, ids } from './admin-fixture'

const version = 'aaaaaaaa-0000-0000-0000-000000000001'
const analysis = {
  from: '2026-09-15',
  to: '2026-09-22',
  cutoff: '2026-09-22T14:50:00Z',
  toleranceMinutes: 30,
  vrSeconds: null,
  mondaySeconds: 3600,
  deltaSeconds: null,
  hasIssues: true,
  days: [
    {
      day: '2026-09-22',
      vrSeconds: null,
      mondaySeconds: 3600,
      deltaSeconds: null,
      partial: true,
      issues: ['incomplete'],
    },
  ],
}

test('global settings update and versioned deletion remain explicitly global', async ({ page }) => {
  await fixture(page)
  const saves: unknown[] = []
  await page.route('**/api/v1/time-control/settings', async (route) => {
    if (route.request().method() === 'PATCH') saves.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        toleranceMinutes: 30,
        timeZoneId: 'America/Sao_Paulo',
        automaticEnabled: false,
        version,
      },
    })
  })
  let deleted = false
  await page.route('**/api/v1/time-control/notification-schedules**', async (route) => {
    if (route.request().method() === 'DELETE') {
      deleted = true
      expect(route.request().url()).toContain(`version=${version}`)
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({
      json: deleted
        ? []
        : [
            {
              id: ids.batch,
              localTime: '11:50:00',
              message: 'Hora do almoço',
              kind: 'lunch',
              isEnabled: true,
              version,
            },
          ],
    })
  })
  await page.getByRole('button', { name: 'Configurações globais', exact: true }).click()
  await page.getByLabel('Tolerância diária em minutos').fill('45')
  await page.getByRole('button', { name: 'Salvar configuração global' }).click()
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0]).toEqual({ version, toleranceMinutes: 45, automaticEnabled: false })
  await page.getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(page.getByText('Isso afeta todas as organizações.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click()
  await expect(page.getByText('Nenhum agendamento', { exact: true })).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])
})

test('instant dispatch uses server preview, confirmation and one retained key after network uncertainty', async ({
  page,
}) => {
  await fixture(page)
  const bodies: { requestId: string; userId: string | null; period: string }[] = []
  await page.route('**/notification-dispatches**', async (route) => {
    if (route.request().url().includes('/preview')) {
      await route.fulfill({
        json: {
          from: '2026-09-15',
          to: '2026-09-22',
          cutoff: '2026-09-22T14:50:00Z',
          recipientCount: 2,
        },
      })
      return
    }
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postDataJSON())
      if (bodies.length === 1) {
        await route.abort()
        return
      }
      await route.fulfill({
        status: 202,
        json: { id: ids.batch, status: 'pending', recipientCount: 2 },
      })
      return
    }
    await route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
  })
  await page.getByRole('button', { name: 'Enviar aviso', exact: true }).click()
  await page.getByRole('combobox', { name: 'Análise', exact: true }).selectOption('sprint')
  await page.getByLabel('Mensagem', { exact: true }).fill('Confira a sprint')
  await expect(page.getByText('Prévia: 2 destinatário(s)', { exact: false })).toBeVisible()
  const send = page.getByRole('button', { name: 'Enviar notificação', exact: true })
  await expect(send).toBeDisabled()
  await page.getByLabel('Confirmo a mensagem').check()
  await send.click()
  await expect(page.getByRole('alert')).toBeVisible()
  await send.click()
  await expect(
    page.getByText('Solicitação registrada para 2 destinatário(s).', { exact: false }),
  ).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[0].requestId).toBe(bodies[1].requestId)
  expect(bodies[1].userId).toBeNull()
  expect(bodies[1].period).toBe('sprint')
})

test('inbox preserves unknown totals and original analysis; expanding does not mark read', async ({
  page,
}) => {
  await fixture(page)
  let read = false
  await page.route('**/api/v1/me/notifications**', async (route) => {
    if (route.request().method() === 'POST') {
      read = true
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({
      json: {
        items: read
          ? []
          : [
              {
                id: ids.batch,
                message: 'Confira a pendência',
                createdAt: '2026-09-22T14:50:00Z',
                analysis,
              },
            ],
        total: read ? 0 : 1,
        page: 1,
        pageSize: 20,
      },
    })
  })
  await page.getByRole('button', { name: 'Minhas notificações', exact: true }).click()
  await page.getByText('Ver análise anexada').click()
  await expect(page.getByText('Dados insuficientes', { exact: true })).toBeVisible()
  await expect(page.getByText('Indisponível', { exact: true }).first()).toBeVisible()
  expect(read).toBe(false)
  await page.getByRole('button', { name: 'Marcar como lida' }).click()
  await expect(page.getByText('Nenhuma notificação neste filtro')).toBeVisible()
})
