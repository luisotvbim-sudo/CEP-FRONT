import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  await page.goto('/?preview=analysis')
  await expect(page.getByText('PRÉVIA LOCAL · DADOS FICTÍCIOS')).toBeVisible()
})

test('preview screens are accessible and do not call any backend or store demo data', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url())
  })
  await page.reload()
  for (const title of [
    'Minha análise',
    'Notificações',
    'Relatórios de erros',
    'Enviar agora',
    'Histórico de envios',
    'Agendamentos',
    'Configurações globais',
  ]) {
    await page.getByRole('navigation').getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([])
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  expect(requests).toEqual([])
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 })
})

test('global settings have no assumed tolerance and handle conflict without losing the draft', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Configurações globais', exact: true }).click()
  const input = page.getByLabel('Tolerância diária (minutos)', { exact: true })
  await expect(input).toHaveValue('')
  await input.fill('15')
  await page.getByLabel('Cenário de demonstração').selectOption('conflict')
  await expect(input).toHaveValue('15')
  await expect(page.getByRole('button', { name: 'Revisar rascunho' })).toBeDisabled()
  await page.getByLabel('Cenário de demonstração').selectOption('ready')
  await page.getByRole('button', { name: 'Revisar rascunho' }).click()
  await expect(page.getByRole('dialog')).toContainText('todas as organizações')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(input).toHaveValue('15')
})

test('schedule drafts can be edited and deletion requires confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'Agendamentos', exact: true }).click()
  await page.getByRole('button', { name: 'Editar 10:00', exact: true }).click()
  await page.getByLabel('Horário', { exact: true }).fill('10:15')
  await page.getByLabel('Ativo na prévia', { exact: true }).check()
  await page.getByRole('button', { name: 'Aplicar na prévia' }).click()
  await expect(page.getByRole('status')).toContainText('Nenhum disparo')
  await page.getByRole('button', { name: 'Excluir 10:15', exact: true }).click()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Editar 10:15', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Excluir 10:15', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar na prévia' }).click()
  await expect(page.getByRole('button', { name: 'Editar 10:15', exact: true })).toHaveCount(0)
})

test('send review invalidates on changes and never claims delivery', async ({ page }) => {
  await page.getByRole('button', { name: 'Enviar agora', exact: true }).click()
  await page.getByLabel('Mensagem', { exact: true }).fill('Revisar registros do período.')
  await page.getByLabel('Sprint', { exact: true }).check()
  await page.getByRole('button', { name: 'Revisar aviso de exemplo' }).click()
  await expect(page.getByRole('region', { name: 'Prévia do aviso' })).toContainText('15/09/2026')
  await page.getByRole('combobox', { name: 'Destinatários', exact: true }).selectOption('all')
  await expect(page.getByRole('region', { name: 'Prévia do aviso' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Revisar aviso de exemplo' }).click()
  await page.getByRole('button', { name: 'Confirmar somente a prévia' }).click()
  await expect(page.getByRole('status')).toContainText('Nenhuma mensagem foi enfileirada')
  await expect(page.getByRole('button', { name: 'Confirmar somente a prévia' })).toBeDisabled()
})

test('member preview preserves delayed notification context and explicit read state', async ({
  page,
}) => {
  await page.getByLabel('Perfil de demonstração').selectOption('member')
  await expect(
    page.getByRole('button', { name: 'Configurações globais', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Enviar agora', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Notificações', exact: true }).click()
  const entry = page.getByRole('button', { name: /Conferência parcial do expediente/ })
  await entry.click()
  await expect(entry).toContainText('Não lida')
  await expect(page.getByText(/Aviso atrasado/)).toBeVisible()
  await page.getByRole('button', { name: 'Marcar como lida na prévia' }).click()
  await expect(entry).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Exibir', exact: true }).selectOption('all')
  await expect(entry).toContainText('Lida na prévia')
})

test('unavailable data does not become zero and transient states are recoverable', async ({
  page,
}) => {
  await page.getByLabel('Cenário de demonstração').selectOption('partial')
  const vr = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'VR Mais', exact: true }) })
  await expect(vr).toContainText('—')
  await expect(vr).not.toContainText('00h00')
  for (const scenario of ['loading', 'offline', 'expired', 'denied', 'unlinked', 'empty']) {
    await page.getByLabel('Cenário de demonstração').selectOption(scenario)
    await expect(
      page.getByRole('heading', { name: 'Qualidade e atualização das fontes' }),
    ).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Voltar ao exemplo disponível' }).click()
  await expect(
    page.getByRole('heading', { name: 'Qualidade e atualização das fontes' }),
  ).toBeVisible()
})
