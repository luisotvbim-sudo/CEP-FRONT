import { expect, test } from '@playwright/test'
import { fixture, disabledBatch } from './admin-fixture'

for (const leader of [false, true]) {
  test(`history sprint update refreshes filters once for ${leader ? 'leader' : 'member'}`, async ({ page }) => {
    const calls = await fixture(page, { role: 'user', leader })
    await page.getByRole('button', { name: 'Meu histórico', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Atualização', exact: true })).toHaveCount(0)
    await expect(page.getByText('Reprocessar até 90 dias e diretórios (carga administrativa)')).toHaveCount(0)
    await page.getByLabel('Fonte', { exact: true }).selectOption('monday')
    await page.getByRole('button', { name: 'Consultar histórico', exact: true }).click()
    await expect(page.getByText(/Consulta gerada em/)).toBeVisible()
    const before = calls.filter(c => c.path.includes('/time-control/history?')).length
    let posts = 0
    await page.route('**/synchronizations?full=false', async route => {
      posts++
      await new Promise(resolve => setTimeout(resolve, 350))
      await route.fulfill({ json: { ...disabledBatch, id: '90000000-0000-0000-0000-000000000001', status: 'partiallySucceeded' } })
    })
    await page.getByRole('button', { name: 'Atualizar sprint', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Coleta em andamento…' })).toBeDisabled()
    await expect.poll(() => calls.filter(c => c.path.includes('/time-control/history?')).length).toBe(before + 1)
    expect(posts).toBe(1)
    expect(calls.filter(c => c.path.includes('/time-control/history?')).at(-1)?.path).toContain('source=monday')
    await expect(page.getByLabel('Fonte', { exact: true })).toHaveValue('monday')
  })
}
