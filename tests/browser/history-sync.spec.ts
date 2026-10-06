import { expect, test } from '@playwright/test'
import { fixture, disabledBatch, ids, person } from './admin-fixture'

for (const leader of [false, true]) {
  test(`history sprint update refreshes filters once for ${leader ? 'leader' : 'member'}`, async ({ page }) => {
    const calls = await fixture(page, { role: 'user', leader })
    await page.getByRole('button', { name: 'Meu histórico', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Atualização', exact: true })).toHaveCount(0)
    await expect(page.getByText('Reprocessar até 90 dias e diretórios (carga administrativa)')).toHaveCount(0)
    await expect(page.getByText('Revalida os últimos 20 dias inclusivos das duas fontes. Confira o resultado de Monday e VR Mais abaixo.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Atualizar dados das fontes' })).toHaveCount(0)
    await expect(page.getByText('Cobertura dos registros')).toHaveCount(0)
    await page.getByLabel('Fonte', { exact: true }).selectOption('monday')
    await page.getByRole('button', { name: 'Consultar histórico', exact: true }).click()
    await expect(page.getByText(/Consulta gerada em/)).toBeVisible()
    const before = calls.filter(c => c.path.includes('/time-control/history?')).length
    let posts = 0
    await page.route('**/synchronizations?full=false', async route => {
      posts++
      await new Promise(resolve => setTimeout(resolve, 350))
      await route.fulfill({ json: { ...disabledBatch, id: '90000000-0000-0000-0000-000000000001', status: 'partiallySucceeded', sources: [
        { source: 'monday', status: 'succeeded', coverageFrom: '2026-09-02', coverageTo: '2026-09-21' }, disabledBatch.sources[1],
      ] } })
    })
    await page.getByRole('button', { name: 'Revalidar Monday e VR Mais (20 dias)', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Reprocessando dados…' })).toBeDisabled()
    await expect.poll(() => calls.filter(c => c.path.includes('/time-control/history?')).length).toBe(before + 1)
    await expect(page.getByRole('main').getByRole('status')).toContainText('Monday: Concluída · VR Mais: integração desabilitada')
    expect(posts).toBe(1)
    expect(calls.filter(c => c.path.includes('/time-control/history?')).at(-1)?.path).toContain('source=monday')
    await expect(page.getByLabel('Fonte', { exact: true })).toHaveValue('monday')
  })
}

test('revalidation finds the own person and loads twenty days without treating an unavailable source as zero', async ({ page }) => {
  const calls = await fixture(page, { role: 'user', empty: true })
  await page.getByRole('button', { name: 'Meu histórico', exact: true }).click()
  await expect(page.getByText('Não encontramos uma pessoa associada à sua conta.')).toBeVisible()
  let peopleReloaded = false
  await page.route('**/time-control/people?*', (route) => {
    peopleReloaded = true
    return route.fulfill({ json: { items: [{ ...person, userId: ids.user }], total: 1, page: 1, pageSize: 100 } })
  })
  const id = '90000000-0000-0000-0000-000000000002'
  const completedBatch = { ...disabledBatch, id, status: 'partiallySucceeded', sources: [
    { source: 'monday', status: 'succeeded', coverageFrom: '2026-09-02', coverageTo: '2026-09-21' },
    disabledBatch.sources[1],
  ] }
  await page.route('**/synchronizations?full=false', (route) => route.fulfill({ json: {
    ...completedBatch, status: 'running', completedAt: null, sources: [],
  } }))
  await page.route(`**/synchronizations/${id}`, (route) => route.fulfill({ json: completedBatch }))
  await page.getByRole('button', { name: 'Revalidar Monday e VR Mais (20 dias)' }).click()
  await expect(page.getByRole('button', { name: 'Reprocessando dados…' })).toBeDisabled()
  await expect(page.getByRole('main').getByRole('status')).toContainText('Monday: Concluída · VR Mais: integração desabilitada')
  await expect.poll(() => peopleReloaded).toBe(true)
  await expect(page.getByRole('heading', { name: 'Ana Exemplo' })).toBeVisible()
  await expect(page.getByText('Nenhum registro importado neste período')).toBeVisible()
  const historyCall = calls.find((call) => call.path.includes(`workforcePersonId=${ids.person}`))
  expect(historyCall).toBeDefined()
  const period = new URL(historyCall!.path, 'http://test').searchParams
  expect((Date.parse(period.get('to')!) - Date.parse(period.get('from')!)) / 86400000 + 1).toBe(20)
})
