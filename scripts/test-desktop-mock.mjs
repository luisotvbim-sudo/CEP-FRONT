import { spawn } from 'node:child_process'
import { readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

// Explicit fixture accounts only. No demo login, invitations, traces or token output.
// Run Node with --use-system-ca; never bypass HTTPS certificate validation.
const argumentsMap = new Map(process.argv.slice(2).map((value) => {
  const at = value.indexOf('=')
  return [value.slice(0, at), value.slice(at + 1)]
}))
const passwordPath = argumentsMap.get('--password-file')
assert.ok(passwordPath && path.isAbsolute(passwordPath), 'Provide an absolute --password-file')
const password = (await readFile(passwordPath, 'utf8')).trim()
const fixtureEmail = 'member.a@example.test'
const apiOrigin = 'https://localhost:9443'
const stateRoot = path.join(process.env.LOCALAPPDATA, 'Conceito', 'CepHoras-Mock-Test')
const sessionDirectory = path.join(stateRoot, 'Sessions')
const executable = path.resolve('.local/desktop-mock-environment/payload/CepHoras.exe')
const scenarioPath = argumentsMap.get('--scenarios-file')
const identitiesPath = argumentsMap.get('--identities-file')
let child, browser, page, sourceRestore
let coordinatorToken, coordinatorRefresh, fixtureLoggedIn = false
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const events = () => readFile(path.join(sessionDirectory, 'native-ui.events'), 'utf8').catch(() => '')
const countPopups = (value) => value.split('\n').filter((line) => line.trim() === 'notification-summary-requested').length

async function fixtureApi(method, route, body) {
  const response = await fetch(apiOrigin + '/api/v1' + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(coordinatorToken ? { Authorization: `Bearer ${coordinatorToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) throw new Error(`Fixture API ${route}: HTTP ${response.status}; no automatic write replay`)
  return response.status === 204 ? null : response.json()
}

async function open() {
  const reservation = createServer()
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  child = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env, CEP_DESKTOP_LOCAL_TEST: '1', CEP_DESKTOP_TEST_TARGET: 'mock', CEP_DESKTOP_TESTING: '1',
    CEP_API_URL: apiOrigin, CEP_SESSION_DIR: sessionDirectory,
    WEBVIEW2_USER_DATA_FOLDER: path.join(stateRoot, 'WebView2'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`,
  } })
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error('Mock desktop exited before startup')
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break
    } catch { /* Startup is still in progress. */ }
    await pause(250)
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = browser.contexts()[0].pages()[0]
  await page.waitForFunction(() => window.__CEP_DOCUMENT_ID__ && document.querySelector('#root')?.childElementCount)
}

async function bridge(type, operation, payload = {}) {
  return page.evaluate(({ type, operation, payload }) => new Promise((resolve) => {
    const id = crypto.randomUUID()
    const listener = (event) => {
      if (event.data.id !== id) return
      window.chrome.webview.removeEventListener('message', listener)
      resolve(event.data)
    }
    window.chrome.webview.addEventListener('message', listener)
    window.chrome.webview.postMessage({ type, documentId: window.__CEP_DOCUMENT_ID__, id, operation, payload })
  }), { type, operation, payload })
}
async function api(method, route, body) {
  const reply = await bridge('cep-auth', 'api', { method, path: route, ...(body ? { body } : {}) })
  if (!reply.ok) throw new Error(`Native fixture request failed: ${reply.error?.code ?? 'unknown'}`)
  return reply.result
}
async function close() {
  if (page && child?.exitCode === null) {
    await page.evaluate(() => window.chrome.webview.postMessage({ type: 'cep-desktop-test', action: 'exit' })).catch(() => {})
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), pause(3000)])
  }
  await browser?.close()
  if (child?.exitCode === null) child.kill()
  browser = page = undefined
}
async function atomicScenarios(value) {
  const temporary = scenarioPath + '.desktop-test.tmp'
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8' })
  await rename(temporary, scenarioPath)
}

try {
  if (argumentsMap.get('--resume-fixture') !== 'true') {
    const saved = await readdir(sessionDirectory).catch(() => [])
    assert.ok(!saved.some((name) => name.endsWith('.dat')), 'Sign out the mock desktop before running fixture tests')
  }
  await open()
  const startup = await bridge('cep-auth', 'restore')
  if (startup.ok && startup.result) {
    assert.equal(startup.result.user.email, fixtureEmail, 'Refusing a non-fixture saved session')
    await page.getByRole('button', { name: 'Sair da conta' }).click()
  }
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  const initialPopups = countPopups(await events())
  await page.getByLabel('E-mail corporativo').fill(fixtureEmail)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  await page.getByRole('button', { name: 'Sair da conta' }).waitFor({ timeout: 90_000 })
  const metadata = await bridge('cep-auth', 'restore')
  assert.ok(metadata.ok && metadata.result.user.email === fixtureEmail, 'Fixture identity not confirmed')
  assert.ok(!('accessToken' in metadata.result) && !('refreshToken' in metadata.result), 'Native token isolation failed')
  fixtureLoggedIn = true
  const userId = metadata.result.user.id
  console.log('PASS: trusted HTTPS mock native fixture login and token isolation.')

  // Coordinator credentials remain in this harness memory, never in the renderer.
  const coordinatorSession = await fixtureApi('POST', '/auth/login', {
    email: 'coordinator.a@example.test', password, client: { type: 'mock-desktop-fixture', version: '1' },
  })
  coordinatorToken = coordinatorSession.accessToken
  coordinatorRefresh = coordinatorSession.refreshToken
  const message = `TESTE MOCK desktop fixture ${Date.now()}`
  await fixtureApi('POST', '/organization/time-control/notification-dispatches', {
    requestId: crypto.randomUUID(), userId, message, period: 'sprint',
  })
  console.log('Fixture dispatch accepted; waiting for worker and periodic native polling.')
  let notification
  for (const deadline = Date.now() + 180_000; Date.now() < deadline;) {
    const inbox = await api('GET', '/me/notifications?page=1&pageSize=100')
    notification = inbox.items.find((row) => row.message?.startsWith(message))
    if (notification?.deliveredAt) break
    await pause(2000)
  }
  assert.ok(notification?.deliveredAt && !notification.readAt, 'Periodic native receipt did not preserve unread state')
  const pending = await api('GET', '/me/notifications?pendingOnly=true&page=1&pageSize=100')
  assert.ok(!pending.items.some((row) => row.id === notification.id), 'Received fixture is still pending')
  const afterDeliveryEvents = await events()
  assert.ok(countPopups(afterDeliveryEvents) > initialPopups, 'Native notification summary was not requested')
  console.log('PASS: mock fixture notification processed, periodic native receipt persisted, unread preserved, summary requested.')
  console.log(afterDeliveryEvents.includes('popup-shown-by-windows')
    ? 'PASS: Windows reported native popup display.' : 'NOTE: popup requested; Windows did not report display.')

  await close() // Keep native DPAPI session, then exercise real refresh/restore.
  const popupsBeforeRestart = countPopups(await events())
  await open()
  await page.getByRole('button', { name: 'Sair da conta' }).waitFor({ timeout: 90_000 })
  const restored = await bridge('cep-auth', 'restore')
  assert.ok(restored.ok && restored.result.user.email === fixtureEmail, 'DPAPI restart/restore failed')
  const afterRestart = await api('GET', '/me/notifications?page=1&pageSize=100')
  assert.ok(!afterRestart.items.find((row) => row.id === notification.id)?.readAt, 'Restart marked fixture read')
  assert.equal(countPopups(await events()), popupsBeforeRestart, 'Restart repeated an already received summary')
  await page.getByRole('button', { name: 'Minhas notificações', exact: true }).click()
  const article = page.locator('article').filter({ hasText: message })
  await article.getByRole('button', { name: 'Marcar como lida', exact: true }).click()
  for (let attempt = 0; attempt < 20; attempt++) {
    const inbox = await api('GET', '/me/notifications?page=1&pageSize=100')
    if (inbox.items.find((row) => row.id === notification.id)?.readAt) break
    await pause(200)
  }
  const readInbox = await api('GET', '/me/notifications?page=1&pageSize=100')
  assert.ok(readInbox.items.find((row) => row.id === notification.id)?.readAt, 'Explicit fixture read was not persisted')
  console.log('PASS: DPAPI restart/restore, receipt deduplication and explicit UI read for fixture only.')

  const originalDecision = await api('POST', '/me/time-control/power-action-check', { action: 'shutdown' })
  assert.ok(['allowed', 'blocked', 'indeterminate'].includes(originalDecision.decision), 'Invalid API decision')
  console.log(`Mock baseline shutdown decision: ${originalDecision.decision} (${originalDecision.code}).`)
  if (scenarioPath || identitiesPath) {
    assert.ok(scenarioPath && identitiesPath && path.isAbsolute(scenarioPath) && path.isAbsolute(identitiesPath), 'Both absolute source fixture files are required')
    const identities = JSON.parse((await readFile(identitiesPath, 'utf8')).replace(/^\uFEFF/, ''))
    const fixtureIds = identities.filter((row) => row.email === fixtureEmail).map((row) => String(row.id))
    assert.equal(fixtureIds.length, 2, 'Expected exactly the two member fixture source identities')
    const original = JSON.parse((await readFile(scenarioPath, 'utf8')).replace(/^\uFEFF/, ''))
    const originals = new Map(fixtureIds.map((id) => [id, original.overrides?.[id]]))
    const assigned = new Map()
    sourceRestore = async () => {
      const current = JSON.parse((await readFile(scenarioPath, 'utf8')).replace(/^\uFEFF/, ''))
      for (const id of fixtureIds) {
        assert.equal(JSON.stringify(current.overrides?.[id]), assigned.get(id), 'Concurrent fixture source edit; refusing to overwrite')
        if (originals.get(id) === undefined) delete current.overrides[id]
        else current.overrides[id] = originals.get(id)
      }
      await atomicScenarios(current)
    }
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    for (const expected of ['allowed', 'blocked', 'indeterminate']) {
      const current = JSON.parse((await readFile(scenarioPath, 'utf8')).replace(/^\uFEFF/, ''))
      const days = [{ name: 'TESTE MOCK desktop energy fixture', date, mondayHours: expected === 'blocked' ? 2 : 1,
        vrTotal: '01:00', cards: ['08:00', '09:00'], manual: true, running: false, vrMissing: expected === 'indeterminate' }]
      current.overrides ??= {}
      for (const id of fixtureIds) { current.overrides[id] = days; assigned.set(id, JSON.stringify(days)) }
      await atomicScenarios(current)
      const check = await api('POST', '/me/time-control/power-action-check', { action: 'shutdown' })
      assert.equal(check.decision, expected, `API fixture decision did not match ${expected}`)
      const requestId = crypto.randomUUID()
      const scheduled = await bridge('cep-power', 'schedule', {
        requestId, action: 'shutdown', delaySeconds: 10,
        authorization: { kind: 'api', check: { ...check, decision: 'allowed' } },
      })
      if (expected === 'allowed') {
        assert.ok(scheduled.ok && scheduled.result.requestId === requestId, 'Authorized simulation did not schedule')
        const cancelled = await bridge('cep-power', 'cancel', { requestId })
        assert.ok(cancelled.ok && cancelled.result.cancelled, 'Simulation cancellation failed')
      } else {
        assert.ok(!scheduled.ok && scheduled.error.code === 'power_not_authorized', 'Host trusted a fabricated renderer permission')
      }
      console.log(`PASS: API ${expected}, native revalidation, ${expected === 'allowed' ? 'memory simulation/cancellation' : 'scheduling denied'}.`)
    }
    await sourceRestore()
    sourceRestore = undefined
    const restoredDecision = await api('POST', '/me/time-control/power-action-check', { action: 'shutdown' })
    assert.equal(restoredDecision.decision, originalDecision.decision, 'Restored fixture sources changed baseline decision')
    console.log('PASS: fixture source overrides restored; demo overrides preserved; no reimport or real power.')
  }
  await page.getByRole('button', { name: 'Sair da conta' }).click()
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  fixtureLoggedIn = false
  console.log('PASS: fixture logged out; desktop ready for manual demo login.')
} catch (error) {
  console.error('FAIL: ' + String(error.message).split('\n')[0].replaceAll(password, '[private]'))
  process.exitCode = 1
} finally {
  try { await sourceRestore?.() } finally {
    // Revoke only the coordinator fixture session created by this harness.
    if (coordinatorToken) await fixtureApi('POST', '/auth/logout', { refreshToken: coordinatorRefresh }).catch(() => {})
    coordinatorToken = coordinatorRefresh = undefined
    if (fixtureLoggedIn && page) await bridge('cep-auth', 'logout').catch(() => {})
    await close()
  }
}
