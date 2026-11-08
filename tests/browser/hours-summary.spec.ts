import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fixture, mockHours } from './admin-fixture'

test('summary drills into the team membership period and exports the loaded report', async ({
  page,
}) => {
  const calls = await fixture(page)
  await page
    .getByRole('navigation', { name: 'Navegação administrativa' })
    .getByRole('button', { name: 'Horas', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Toda a organização' })).toBeVisible()
  await expect(page.getByText('16:00', { exact: true })).toHaveCount(2)
  const sourceChart = page.getByRole('figure', { name: 'Horas conhecidas por fonte' })
  const coverageChart = page.getByRole('figure', { name: 'Cobertura da comparação' })
  await expect(sourceChart.getByText('16:00 h', { exact: true })).toHaveCount(2)
  await expect(coverageChart).toContainText('Comparáveis: 2')
  const groups = page.getByRole('group', { name: 'Agrupar resumo por' })
  await groups.getByRole('button', { name: 'Times' }).click()
  await page.getByRole('button', { name: 'Time teste horas', exact: true }).click()
  await expect(sourceChart.getByText('08:00 h', { exact: true })).toHaveCount(2)
  await expect(coverageChart).toContainText('Comparáveis: 1')
  await page.getByRole('button', { name: 'Pessoa teste horas', exact: true }).click()
  await expect(page.getByRole('button', { name: '20/09/2026', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '19/09/2026', exact: true })).toHaveCount(0)
  await groups.getByRole('button', { name: 'Pessoas' }).click()
  await page.getByRole('button', { name: 'Pessoa teste horas', exact: true }).click()
  await expect(page.getByRole('button', { name: '19/09/2026', exact: true })).toBeVisible()
  const reportRequests = calls.filter((call) => call.path.includes('/hours-summary')).length
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar Excel', exact: true }).click()
  const workbook = await download
  expect(workbook.suggestedFilename()).toBe(`cep-horas-${mockHours.from}-a-${mockHours.to}.xlsx`)
  expect((await readFile((await workbook.path())!)).subarray(0, 4)).toEqual(
    Buffer.from([0x50, 0x4b, 3, 4]),
  )
  expect(calls.filter((call) => call.path.includes('/hours-summary'))).toHaveLength(reportRequests)
})
