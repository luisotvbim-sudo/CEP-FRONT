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
                override: false,
                unlockedUntil: null,
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
    await expect(menu(page).getByLabel('PIN administrativo', { exact: true })).toBeVisible()
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

// Deliberately unrelated to the workstation clock. This is a fixture, not a real PIN.
const unlockResponse = {
  override: true,
  serverTime: '2000-01-01T12:00:00Z',
  unlockedUntil: '2000-01-01T12:05:00Z',
}
async function unlockFixture(page: Page, status = 200) {
  const requests: { url: string; body: unknown }[] = []
  await page.route('**/api/v1/me/time-control/power-action-unlock', async (route) => {
    requests.push({ url: route.request().url(), body: route.request().postDataJSON() })
    await route.fulfill({
      status,
      json:
        status === 200
          ? unlockResponse
          : {
              code:
                status === 403
                  ? 'invalid_admin_pin'
                  : status === 429
                    ? 'power_unlock_rate_limited'
                    : 'power_pin_not_configured',
              correlationId: 'unlock-fixture',
            },
    })
  })
  return requests
}
async function submitPin(page: Page, pin = '012345') {
  await menu(page).getByLabel('PIN administrativo', { exact: true }).fill(pin)
  await menu(page).getByRole('button', { name: 'Liberar por 5 minutos', exact: true }).click()
  await expect(menu(page).getByLabel('PIN administrativo', { exact: true })).toHaveValue('')
}
test('PIN format is exactly six ASCII digits and clears after invalid attempts', async ({
  page,
}) => {
  await fixture(page)
  const requests = await unlockFixture(page)
  await openMenu(page)
  const input = menu(page).getByLabel('PIN administrativo', { exact: true })
  for (const [name, value] of Object.entries({
    type: 'password',
    inputmode: 'numeric',
    autocomplete: 'off',
    minlength: '6',
    maxlength: '6',
    pattern: '[0-9]{6}',
  }))
    await expect(input).toHaveAttribute(name, value)
  for (const pin of ['12345', '12a456', '１２３４５６']) {
    await submitPin(page, pin)
    await expect(menu(page)).toContainText('Informe exatamente 6 dígitos numéricos.')
  }
  expect(requests).toHaveLength(0)
})
for (const status of [403, 429, 503]) {
  test(`unlock ${status} clears PIN and never enters contingency`, async ({ page }) => {
    await fixture(page)
    await nativeFixture(page)
    const requests = await unlockFixture(page, status)
    await openMenu(page)
    await submitPin(page)
    await expect(menu(page)).toContainText(
      status === 403
        ? 'PIN administrativo inválido'
        : status === 429
          ? 'Limite de liberações atingido'
          : 'PIN administrativo ainda não foi configurado',
    )
    await expect(menu(page)).not.toContainText('liberados temporariamente por')
    expect(await operations(page)).toEqual([])
    expect(requests).toHaveLength(1)
  })
}
test('correct PIN shows server-based countdown and each of the three actions still checks the API', async ({
  page,
}) => {
  await fixture(page)
  await nativeFixture(page)
  await page.clock.install()
  const requests = await unlockFixture(page)
  const actions: string[] = []
  await page.route('**/api/v1/me/time-control/power-action-check', async (route) => {
    const action = route.request().postDataJSON().action
    actions.push(action)
    await route.fulfill({
      json: {
        action,
        decision: 'allowed',
        code: 'administrative_override',
        message: 'Liberação temporária.',
        analysis: null,
        override: true,
        unlockedUntil: unlockResponse.unlockedUntil,
      },
    })
  })
  await openMenu(page)
  await submitPin(page)
  await expect(menu(page)).toContainText('liberados temporariamente por 5:00')
  expect(requests).toEqual([
    {
      url: expect.stringContaining('/me/time-control/power-action-unlock'),
      body: { pin: '012345' },
    },
  ])
  expect(requests[0].url).not.toContain('012345')
  for (const label of ['Desligar', 'Reiniciar', 'Hibernar']) {
    await menu(page).getByRole('button', { name: label, exact: true }).click()
    await expect(menu(page)).toContainText(`${label} em 10 segundos`)
    await menu(page).getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(menu(page)).toContainText('Ação cancelada')
  }
  expect(actions).toEqual(['shutdown', 'restart', 'hibernate'])
  expect(await page.evaluate(() => JSON.stringify((window as any).powerMessages))).not.toContain(
    '012345',
  )
  await page.clock.runFor(60_000)
  await expect(menu(page)).toContainText('liberados temporariamente por 4:00')
})
test('at five minutes the display expires and the server blocks again', async ({ page }) => {
  await fixture(page)
  await nativeFixture(page)
  await page.clock.install()
  await unlockFixture(page)
  await apiFixture(page, 'blocked')
  // The narrower unlock fixture must take priority over the general check fixture.
  await unlockFixture(page)
  await openMenu(page)
  await submitPin(page)
  await expect(menu(page)).toContainText('liberados temporariamente por 5:00')
  await page.clock.runFor(299_000)
  await expect(menu(page)).toContainText('liberados temporariamente por 0:01')
  await page.clock.runFor(1000)
  await expect(menu(page)).toContainText('Liberação temporária encerrada')
  await expect(menu(page)).not.toContainText('liberados temporariamente por')
  await menu(page).getByRole('button', { name: 'Desligar', exact: true }).click()
  await expect(menu(page)).toContainText('Bloqueado.')
  expect(await operations(page)).toEqual([])
})
test('PIN clears on logout, is not persisted, and unlock display does not survive a new login', async ({
  page,
}) => {
  await fixture(page)
  await unlockFixture(page)
  await openMenu(page)
  const consoleMessages: string[] = []
  page.on('console', (message) => consoleMessages.push(message.text()))
  await submitPin(page)
  await expect(menu(page)).toContainText('Liberação administrativa confirmada')
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        url: location.href,
      }),
    ),
  ).not.toContain('012345')
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([])
  expect(consoleMessages.join(' ')).not.toContain('012345')
  const input = menu(page).getByLabel('PIN administrativo', { exact: true })
  await input.fill('654321')
  const element = await input.elementHandle()
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click()
  await expect(menu(page)).toHaveCount(0)
  expect(await element!.evaluate((node) => (node as HTMLInputElement).value)).toBe('')
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('admin@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('Test-only-password')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  await openMenu(page)
  await expect(menu(page).getByLabel('PIN administrativo', { exact: true })).toHaveValue('')
  await expect(menu(page)).not.toContainText('liberados temporariamente por')
})
test('failed PIN does not extend an existing window; status remains GET only', async ({ page }) => {
  await fixture(page)
  await page.clock.install()
  await unlockFixture(page)
  await nativeFixture(page)
  await openMenu(page)
  await submitPin(page)
  await expect(menu(page)).toContainText('liberados temporariamente por 5:00')
  await page.clock.runFor(60_000)
  await unlockFixture(page, 403)
  await submitPin(page, '654321')
  await expect(menu(page)).toContainText('PIN administrativo inválido')
  await expect(menu(page)).toContainText('liberados temporariamente por 4:00')
  let requests = 0
  await page.route('**/api/v1/me/time-control/power-action-status**', (route) => {
    expect(route.request().method()).toBe('GET')
    requests++
    return route.fulfill({
      json: {
        action: 'shutdown',
        decision: 'allowed',
        code: 'administrative_override',
        message: 'Liberação temporária.',
        analysis: null,
        override: true,
        unlockedUntil: unlockResponse.unlockedUntil,
      },
    })
  })
  await menu(page).getByRole('button', { name: 'Verificar status', exact: true }).click()
  await expect(menu(page)).toContainText('Liberado.')
  expect(requests).toBe(1)
  expect(await operations(page)).toEqual([])
})
