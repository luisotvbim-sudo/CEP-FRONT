import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture } from './admin-fixture'

const analysis = {
  from: '2026-09-30',
  to: '2026-09-30',
  cutoff: '2026-09-30T20:00:00Z',
  toleranceMinutes: 30,
  settingsVersion: 'aaaaaaaa-0000-0000-0000-000000000001',
  days: [
    {
      day: '2026-09-30',
      vrSeconds: 3600,
      mondaySeconds: 1800,
      deltaSeconds: -1800,
      partial: true,
      issues: [],
    },
  ],
  vrSeconds: 3600,
  mondaySeconds: 1800,
  deltaSeconds: -1800,
  absoluteDivergenceSeconds: 1800,
  hasIssues: false,
  sources: ['monday', 'vrMais'].map((source) => ({
    source,
    status: 'complete',
    errorCode: null,
    observedAt: '2026-09-30T20:00:00Z',
  })),
}
async function apiFixture(page: Page, decision = 'allowed', status = 200, invalid = false) {
  const calls: { method: string; action: string }[] = []
  await page.route('**/api/v1/me/time-control/power-action-*', async (route) => {
    const request = route.request()
    const action =
      request.method() === 'POST'
        ? request.postDataJSON().action
        : new URL(request.url()).searchParams.get('action')
    calls.push({ method: request.method(), action })
    await route.fulfill({
      status,
      json:
        status !== 200
          ? { code: 'unexpected_error', correlationId: 'power-test' }
          : invalid
            ? {}
            : {
                action,
                decision,
                code:
                  decision === 'allowed'
                    ? 'within_tolerance'
                    : decision === 'blocked'
                      ? 'above_tolerance'
                      : 'analysis_incomplete',
                message:
                  decision === 'allowed'
                    ? 'Horas dentro da tolerância.'
                    : 'Confira seus registros antes de continuar.',
                analysis,
              },
    })
  })
  return calls
}
// Fake only the new power protocol, after HTTP login. No test executes OS commands.
async function nativeFixture(page: Page, unreachable = true, cancelFails = false) {
  await page.evaluate(
    ({ unreachable, cancelFails }) => {
      const messages: any[] = []
      ;(window as any).powerMessages = messages
      window.__CEP_DESKTOP__ = true
      window.__CEP_POWER_VERSION__ = 1
      const listeners = new Set<(event: any) => void>()
      window.chrome = {
        webview: {
          addEventListener: (_, listener) => {
            listeners.add(listener)
          },
          removeEventListener: (_, listener) => {
            listeners.delete(listener)
          },
          postMessage: (message: any) => {
            messages.push(message)
            const result =
              message.operation === 'schedule'
                ? {
                    requestId: message.payload.requestId,
                    action: message.payload.action,
                    executeAt: new Date(Date.now() + 10_000).toISOString(),
                  }
                : message.operation === 'cancel'
                  ? { cancelled: !cancelFails }
                  : { unreachable }
            queueMicrotask(() =>
              listeners.forEach((listener) =>
                listener({ data: { id: message.id, ok: true, result } }),
              ),
            )
          },
        },
      }
    },
    { unreachable, cancelFails },
  )
}
const menu = (page: Page) => page.getByRole('region', { name: 'Energia do computador' })
async function openMenu(page: Page) {
  await menu(page).locator('summary').click()
}
const operations = (page: Page) =>
  page.evaluate(() => ((window as any).powerMessages || []).map((m: any) => m.operation))

for (const profile of [
  { role: 'organizationAdmin' },
  { role: 'systemAdmin' },
  { role: 'user' },
  { role: 'user', leader: true },
]) {
  test(`menu in authenticated ${profile.role} leader=${!!profile.leader}`, async ({
    page,
  }, testInfo) => {
    await fixture(page, profile)
    await openMenu(page)
    for (const name of ['Desligar', 'Reiniciar', 'Hibernar', 'Verificar status'])
      await expect(menu(page).getByRole('button', { name, exact: true })).toBeVisible()
    if (profile.role === 'systemAdmin') {
      await page.route('**/api/v1/time-control/settings', (route) =>
        route.fulfill({
          json: {
            toleranceMinutes: 30,
            automaticEnabled: false,
            timeZoneId: 'America/Sao_Paulo',
            version: analysis.settingsVersion,
          },
        }),
      )
      await page.route('**/api/v1/time-control/notification-schedules', (route) =>
        route.fulfill({ json: [] }),
      )
      await page.getByRole('button', { name: 'Configurações globais', exact: true }).click()
      await expect(menu(page)).toBeVisible()
      await page.getByRole('button', { name: 'Voltar às organizações' }).click()
      await page.getByRole('button', { name: 'Administrar', exact: true }).first().click()
      await expect(menu(page)).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      await menu(page).evaluate((el) => el.getBoundingClientRect().top),
    ).toBeGreaterThanOrEqual(
      await page.locator('.admin-app').evaluate((el) => el.getBoundingClientRect().bottom),
    )
    if (profile.role === 'organizationAdmin')
      await page.screenshot({
        path: `.local/power-menu-${testInfo.project.name}.png`,
        fullPage: true,
      })
  })
}
test('menu absent from login and public download', async ({ page }) => {
  await page.route('**/auth/web/refresh', (route) => route.fulfill({ status: 401, json: {} }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Entrar na minha conta' })).toBeVisible()
  await expect(menu(page)).toHaveCount(0)
  await page.goto('/download')
  await expect(menu(page)).toHaveCount(0)
})
test('status is GET only; allowed browser never schedules; keyboard and accessibility', async ({
  page,
}) => {
  await fixture(page)
  const calls = await apiFixture(page)
  const summary = menu(page).locator('summary')
  await summary.focus()
  await page.keyboard.press('Enter')
  await menu(page).getByRole('button', { name: 'Verificar status' }).click()
  await expect(menu(page)).toContainText('Tolerância: 30 minutos.')
  expect(calls).toEqual([{ method: 'GET', action: 'shutdown' }])
  await menu(page).getByRole('button', { name: 'Desligar', exact: true }).click()
  await expect(menu(page)).toContainText('A execução está disponível no aplicativo Windows.')
  await expect(menu(page).getByRole('button', { name: 'Cancelar', exact: true })).toHaveCount(0)
  expect(
    (
      await new AxeBuilder({ page })
        .include('.power-menu')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze()
    ).violations,
  ).toEqual([])
})
for (const outcome of ['blocked', 'indeterminate', 'technical', 'invalid']) {
  test(`${outcome} never schedules nor verifies offline`, async ({ page }) => {
    await fixture(page)
    await nativeFixture(page)
    await apiFixture(page, outcome, outcome === 'technical' ? 500 : 200, outcome === 'invalid')
    await openMenu(page)
    await menu(page).getByRole('button', { name: 'Desligar', exact: true }).click()
    await expect(menu(page)).toContainText(
      outcome === 'technical'
        ? 'Código para suporte: power-test'
        : outcome === 'invalid'
          ? 'resposta inválida'
          : 'Confira seus registros',
    )
    expect(await operations(page)).toEqual([])
  })
}
for (const [action, label] of [
  ['shutdown', 'Desligar'],
  ['restart', 'Reiniciar'],
  ['hibernate', 'Hibernar'],
]) {
  test(`${action}: ten-second countdown and native cancellation`, async ({ page }) => {
    await fixture(page)
    await nativeFixture(page)
    await apiFixture(page)
    await page.clock.install()
    await openMenu(page)
    await menu(page).getByRole('button', { name: label, exact: true }).click()
    await expect(menu(page)).toContainText(`${label} em 10 segundos.`)
    await expect(menu(page).getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused()
    await page.clock.runFor(9_000)
    await expect(menu(page)).toContainText(`${label} em 1 segundo.`)
    expect(await operations(page)).toEqual(['schedule'])
    await menu(page).getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(menu(page)).toContainText('Ação cancelada pelo aplicativo.')
    await page.clock.runFor(2_000)
    expect(await operations(page)).toEqual(['schedule', 'cancel'])
    await expect(menu(page).getByRole('button', { name: label, exact: true })).toBeEnabled()
  })
}
test('deadline does not send a second execute command', async ({ page }) => {
  await fixture(page)
  await nativeFixture(page)
  await apiFixture(page)
  await page.clock.install()
  await openMenu(page)
  await menu(page).getByRole('button', { name: 'Desligar', exact: true }).click()
  await expect(menu(page)).toContainText('em 10 segundos')
  await page.clock.runFor(10_000)
  await expect(menu(page)).toContainText('Prazo do agendamento atingido')
  expect(await operations(page)).toEqual(['schedule'])
})
for (const unreachable of [true, false]) {
  test(`offline candidate requires native verification=${unreachable}`, async ({ page }) => {
    await fixture(page)
    await nativeFixture(page, unreachable)
    await page.route('**/api/v1/me/time-control/power-action-check', (route) =>
      route.abort('connectionrefused'),
    )
    await openMenu(page)
    await menu(page).getByRole('button', { name: 'Desligar', exact: true }).click()
    await expect(menu(page)).toContainText(
      unreachable ? 'Ação permitida em contingência' : 'Não foi possível conectar',
    )
    expect(await operations(page)).toEqual(
      unreachable ? ['verify-api-unreachable', 'schedule'] : ['verify-api-unreachable'],
    )
  })
}
test('failed cancellation keeps retry available', async ({ page }) => {
  await fixture(page)
  await nativeFixture(page, true, true)
  await apiFixture(page)
  await openMenu(page)
  await menu(page).getByRole('button', { name: 'Reiniciar', exact: true }).click()
  const cancel = menu(page).getByRole('button', { name: 'Cancelar', exact: true })
  await cancel.click()
  await expect(menu(page)).toContainText('cancelamento não foi confirmado')
  await expect(cancel).toBeEnabled()
  await expect(menu(page).getByRole('button', { name: 'Desligar', exact: true })).toBeDisabled()
})
