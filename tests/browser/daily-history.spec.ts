import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture, ids } from './admin-fixture'

test('daily history groups sources, expands with keyboard, preserves seconds and resets on filters', async ({
  page,
}) => {
  await fixture(page)
  await page.route('**/history?**', (route) =>
    route.fulfill({
      json: {
        from: '2026-09-01',
        to: '2026-09-21',
        generatedAt: '2026-09-21T12:00:00Z',
        people: [
          {
            workforcePersonId: ids.person,
            displayName: 'Pessoa de teste',
            days: [
              {
                day: '2026-09-01',
                mondaySeconds: 31801,
                vrSeconds: 32580,
                deltaSeconds: -779,
                partial: false,
                issues: [],
              },
              {
                day: '2026-09-02',
                mondaySeconds: 7200,
                vrSeconds: 3600,
                deltaSeconds: 3600,
                partial: false,
                issues: [],
              },
              {
                day: '2026-09-03',
                mondaySeconds: 0,
                vrSeconds: 0,
                deltaSeconds: 0,
                partial: false,
                issues: [],
              },
            ],
            records: [
              {
                id: '1',
                workDate: '2026-09-01',
                source: 'monday',
                title: 'Projeto A',
                detailsJson: '{"manual":true}',
                url: 'https://example.test/activity',
                durationSeconds: 14400,
                state: 'closed',
              },
              {
                id: '2',
                workDate: '2026-09-01',
                source: 'monday',
                title: 'Projeto B',
                detailsJson: '{"manual":false}',
                durationSeconds: 17401,
                state: 'closed',
              },
              {
                id: '3',
                workDate: '2026-09-01',
                source: 'vrMais',
                durationSeconds: 32580,
                state: 'reported',
                detailsJson: '{"timeCards":["08:00","12:00","13:00","18:03"]}',
              },
              {
                id: '4',
                workDate: '2026-09-02',
                source: 'monday',
                durationSeconds: 7200,
                state: 'closed',
              },
              {
                id: '5',
                workDate: '2026-09-03',
                source: 'monday',
                durationSeconds: 0,
                state: 'closed',
              },
            ],
          },
        ],
      },
    }),
  )
  await page.getByRole('button', { name: 'Ver histórico' }).click()
  await page.getByRole('button', { name: 'Consultar histórico' }).click()
  await expect(page.getByRole('button', { name: /Expandir dia/ })).toHaveCount(3)
  await expect(page.getByText('Projeto A', { exact: true })).toBeHidden()
  await expect(page.getByRole('cell', { name: '08:50:01', exact: true })).toBeVisible()
  await expect(page.getByText('−00:12:59 · Faltando no Monday')).toBeVisible()
  await expect(page.getByText('+01:00 · Sobrando no Monday')).toBeVisible()
  await expect(page.getByText('00:00 · Sem diferença')).toBeVisible()
  const toggle = page.getByRole('button', { name: 'Expandir dia 01/09/2026' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Projeto A', { exact: true })).toBeVisible()
  await expect(page.getByText('Projeto B', { exact: true })).toBeVisible()
  const monday = page.getByRole('region', { name: 'Monday em 01/09/2026', exact: true })
  await monday.getByText('Detalhes do registro').nth(0).click()
  await monday.getByText('Detalhes do registro').nth(1).click()
  await expect(monday.getByText('Manual', { exact: true })).toBeVisible()
  await expect(monday.getByText('Cronômetro', { exact: true })).toBeVisible()
  await expect(monday.getByRole('link', { name: 'Abrir atividade' })).toHaveAttribute('href', 'https://example.test/activity')
  await expect(monday.getByText('Importado em', { exact: true })).toHaveCount(0)
  await expect(monday.getByText('Referência externa', { exact: true })).toHaveCount(0)
  const vr = page.getByRole('region', { name: 'VR Mais em 01/09/2026', exact: true })
  await vr.getByText('Detalhes do registro').click()
  await expect(vr.getByText('Batidas informadas: 08:00 · 12:00 · 13:00 · 18:03')).toBeVisible()
  await expect(vr.getByText('Importado em', { exact: true })).toHaveCount(0)
  await expect(vr.getByText('Referência externa', { exact: true })).toHaveCount(0)
  await expect(vr.getByText('Início', { exact: true })).toHaveCount(0)
  await expect(vr.getByText('Fim', { exact: true })).toHaveCount(0)
  await expect(vr.getByText('Cronômetro', { exact: true })).toHaveCount(0)
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  await page.getByLabel('Fonte', { exact: true }).selectOption('monday')
  await expect(page.getByRole('button', { name: /Recolher dia/ })).toHaveCount(0)
  await expect(page.getByText('Projeto A', { exact: true })).toHaveCount(0)
})

for (const leader of [false, true]) {
  test(`shared daily presentation in ${leader ? 'team' : 'personal'} history`, async ({ page }) => {
    await fixture(page, { role: 'user', leader })
    if (leader) {
      await page.getByRole('button', { name: 'Meus times' }).click()
      await page.getByRole('button', { name: 'Projetos de teste' }).click()
      await page.getByRole('button', { name: /Bia Exemplo/ }).click()
    } else await page.getByRole('button', { name: 'Meu histórico', exact: true }).click()
    await page.getByRole('button', { name: 'Consultar histórico' }).click()
    await expect(page.getByRole('columnheader', { name: 'Duração Monday' })).toBeVisible()
    await page.getByRole('button', { name: 'Expandir dia 20/09/2026' }).click()
    await expect(page.getByText('Atividade de teste', { exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Indisponível', exact: true })).toBeVisible()
    await expect(page.getByText('Dados insuficientes', { exact: true })).toBeVisible()
  })
}

test('older API keeps expandable records without locally invented totals', async ({ page }) => {
  await fixture(page)
  await page.route('**/history?**', (route) =>
    route.fulfill({
      json: {
        people: [
          {
            workforcePersonId: ids.person,
            records: [
              {
                id: 'old',
                workDate: '2026-09-20',
                source: 'monday',
                title: 'Registro antigo',
                durationSeconds: 3600,
              },
            ],
          },
        ],
      },
    }),
  )
  await page.getByRole('button', { name: 'Ver histórico' }).click()
  await page.getByRole('button', { name: 'Consultar histórico' }).click()
  await expect(page.getByRole('status')).toContainText('Resumo diário indisponível')
  await page.getByRole('button', { name: 'Expandir dia 20/09/2026' }).click()
  await expect(page.getByText('Registro antigo', { exact: true })).toBeVisible()
  await page.getByText('Detalhes do registro').click()
  const detail = page.locator('.record-details')
  await expect(detail.getByText('Indisponível', { exact: true })).toHaveCount(3)
  await expect(detail.getByText('Cronômetro', { exact: true })).toHaveCount(0)
})
