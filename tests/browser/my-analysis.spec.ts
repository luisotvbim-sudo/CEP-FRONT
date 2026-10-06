import { expect, test } from '@playwright/test'
import { fixture, ids } from './admin-fixture'

const analysis = {
  from: '2026-09-15',
  to: '2026-09-22',
  cutoff: '2026-09-22T14:50:00Z',
  toleranceMinutes: 30,
  vrSeconds: null,
  mondaySeconds: 100800,
  deltaSeconds: null,
  absoluteDivergenceSeconds: null,
  sources: [
    {
      source: 'vrMais',
      status: 'failed',
      observedAt: '2026-09-22T14:50:00Z',
      errorCode: 'fixture',
    },
  ],
  days: [
    {
      day: '2026-09-22',
      vrSeconds: null,
      mondaySeconds: 3600,
      deltaSeconds: null,
      partial: true,
      issues: ['incomplete'],
    },
    {
      day: '2026-09-21',
      vrSeconds: 28800,
      mondaySeconds: 23400,
      deltaSeconds: -5400,
      partial: false,
      issues: ['above_tolerance'],
    },
  ],
}
const row = {
  id: ids.batch,
  workforcePersonId: ids.person,
  userId: ids.user,
  displayName: 'Snapshot fictício',
  createdAt: '2026-09-22T14:50:00Z',
  analysis,
}

test('personal snapshot preserves null, dates, signs, long duration and performs only GET', async ({
  page,
}) => {
  const calls = await fixture(page, { role: 'user', leader: true })
  await page.route('**/time-control/analyses**', async (route) => {
    expect(route.request().method()).toBe('GET')
    expect(new URL(route.request().url()).searchParams.get('workforcePersonId')).toBe(ids.person)
    await route.fulfill({ json: { items: [row], total: 1, page: 1, pageSize: 20 } })
  })
  await page.getByRole('button', { name: 'Minha análise', exact: true }).click()
  await expect(page.getByText('Snapshot fictício', { exact: true })).toBeVisible()
  await expect(page.getByText('28:00', { exact: true })).toBeVisible()
  await expect(page.getByText('−01:30', { exact: true })).toBeVisible()
  await expect(page.getByText('Indisponível', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('22/09/2026 · Parcial', { exact: false })).toBeVisible()
  await expect(page.getByText('Corte: 22/09/2026, 11:50', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Pessoa', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Atualizar consulta', exact: true }).click()
  await expect(page.getByText('Snapshot fictício', { exact: true })).toBeVisible()
  expect(calls.filter((c) => c.method !== 'GET' && !c.path.includes('/auth/'))).toEqual([])
})

test('filters and pagination reset page and retain personal scope', async ({ page }) => {
  await fixture(page, { role: 'user' })
  const queries: URLSearchParams[] = []
  await page.route('**/time-control/analyses**', async (route) => {
    const q = new URL(route.request().url()).searchParams
    queries.push(q)
    await route.fulfill({
      json: {
        items: [{ ...row, displayName: `Página ${q.get('page')}` }],
        total: 21,
        page: Number(q.get('page')),
        pageSize: 20,
      },
    })
  })
  await page.getByRole('button', { name: 'Minha análise', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Página 1', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Próxima página' }).click()
  await expect(page.getByRole('heading', { name: 'Página 2', exact: true })).toBeVisible()
  for (const period of ['weekly', 'sprint', 'previousDay', 'daily']) {
    await page.getByRole('combobox', { name: 'Período', exact: true }).selectOption(period)
    await expect.poll(() => queries.at(-1)?.get('period')).toBe(period)
    expect(queries.at(-1)?.get('page')).toBe('1')
  }
  await page.getByLabel('Dia da ocorrência (opcional)').fill('2026-09-22')
  await page.getByLabel('Tipo de ocorrência').selectOption('incomplete')
  await expect.poll(() => queries.at(-1)?.get('issue')).toBe('incomplete')
  expect(queries.at(-1)?.get('day')).toBe('2026-09-22')
  expect(queries.every((q) => q.get('workforcePersonId') === ids.person)).toBe(true)
})

test('empty and server error are distinct and retry recovers', async ({ page }) => {
  await fixture(page, { role: 'user' })
  let fail = false
  await page.route('**/time-control/analyses**', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { code: 'unavailable' } })
      : route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  )
  await page.getByRole('button', { name: 'Minha análise', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nenhuma análise disponível' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Próxima página' })).toBeDisabled()
  fail = true
  await page.getByRole('button', { name: 'Atualizar consulta' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Atualizar consulta' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Nenhuma análise disponível' })).toBeVisible()
})

test('unassociated member does not query broad report scope', async ({ page }) => {
  const calls = await fixture(page, { role: 'user', empty: true })
  await page.getByRole('button', { name: 'Minha análise', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nenhuma análise disponível' })).toBeVisible()
  expect(calls.some((c) => c.path.includes('/analyses'))).toBe(false)
})
