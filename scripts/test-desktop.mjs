import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'

// Disposable HTTP fixture only. --live tests rejection of a nonexistent account.
const live = process.argv.includes('--live')
const working = path.resolve('.local/desktop-test', `run-${Date.now()}`)
const sessionDirectory = path.join(working, 'sessions')
await mkdir(sessionDirectory, { recursive: true })
const emptyFixtureName = `native-empty-${Date.now()}.html`
const emptyFixturePath = path.resolve(
  'desktop/CepHoras.Desktop/bin/Debug/net10.0-windows/wwwroot',
  emptyFixtureName,
)
await writeFile(
  emptyFixturePath,
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { flag: 'wx' },
)
const user = {
  id: '20000000-0000-0000-0000-000000000001',
  email: 'fixture@example.invalid',
  displayName: 'Teste desktop',
  role: 'organizationAdmin',
  organizationId: '10000000-0000-0000-0000-000000000001',
  status: 'active',
}
let loginBody,
  logoutBody,
  refreshes = 0,
  resends = 0,
  audits = 0,
  userPatches = 0,
  adminInvites = 0,
  protectedCalls = 0
const notificationIds = Array.from(
  { length: 101 },
  (_, i) => `a0000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
)
const deliveredNotifications = new Set()
const pendingPages = []
const tokens = (number, lifetime = 900_000) => ({
  accessToken: `fixture-access-${number}`,
  refreshToken: `fixture-refresh-${number}`,
  accessTokenExpiresAt: new Date(Date.now() + lifetime).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  user,
})
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw || '{}')
  res.setHeader('Content-Type', 'application/json')
  const url = new URL(req.url, 'http://fixture.invalid')
  if (url.pathname === '/api/v1/auth/login') {
    loginBody = body
    res.end(JSON.stringify(tokens(0, 20_000)))
  } else if (url.pathname === '/api/v1/auth/refresh') {
    assert.equal(body.refreshToken, `fixture-refresh-${refreshes}`)
    refreshes++
    // Concurrent People + Invitations requests must use the same refresh operation.
    await new Promise((resolve) => setTimeout(resolve, 100))
    res.end(JSON.stringify(tokens(refreshes)))
  } else if (url.pathname === '/api/v1/auth/logout') {
    logoutBody = body
    res.writeHead(204).end()
  } else if (url.pathname === '/api/v1/me') {
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    res.end(JSON.stringify(user))
  } else if (url.pathname === '/api/v1/me/notifications') {
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    const pending =
      url.searchParams.get('pendingOnly') === 'true'
        ? notificationIds.filter((id) => !deliveredNotifications.has(id))
        : notificationIds
    const page = Number(url.searchParams.get('page') ?? 1)
    const pageSize = Number(url.searchParams.get('pageSize') ?? 100)
    if (url.searchParams.get('pendingOnly') === 'true') pendingPages.push(page)
    res.end(
      JSON.stringify({
        items: pending.slice((page - 1) * pageSize, page * pageSize).map((id) => ({
          id,
          message: 'Notificação descartável do driver WPF, sem envio real.',
          createdAt: '2026-10-05T15:00:00Z',
          readAt: null,
          deliveredAt: deliveredNotifications.has(id) ? '2026-10-05T15:01:00Z' : null,
          analysis: {
            from: '2026-10-05',
            to: '2026-10-05',
            cutoff: '2026-10-05T15:00:00Z',
            toleranceMinutes: 30,
            vrSeconds: null,
            mondaySeconds: null,
            deltaSeconds: null,
            absoluteDivergenceSeconds: null,
            sources: [],
            days: [],
            hasIssues: false,
            settingsVersion: '30000000-0000-0000-0000-000000000001',
          },
        })),
        total: pending.length,
        page,
        pageSize,
      }),
    )
  } else if (url.pathname === '/api/v1/me/notifications/received') {
    assert.equal(req.method, 'POST')
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    assert.ok(pendingPages.includes(2), 'collect every pending page before changing delivery state')
    for (const id of body.ids) deliveredNotifications.add(id)
    res.writeHead(204).end()
  } else if (url.pathname === '/api/v1/organization/time-control/people') {
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    protectedCalls++
    res.end(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 12 }))
  } else if (url.pathname === '/api/v1/organization/audit') {
    assert.equal(req.method, 'GET')
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    audits++
    res.end('[]')
  } else if (url.pathname === `/api/v1/organization/users/${user.id}`) {
    assert.equal(req.method, 'PATCH')
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    userPatches++
    res.end(JSON.stringify({ ...user, ...body }))
  } else if (url.pathname === '/api/v1/organization/invitations' && req.method === 'POST') {
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    adminInvites++
    res.writeHead(201).end(
      JSON.stringify({
        id: '90000000-0000-0000-0000-000000000002',
        email: body.email,
        role: body.role,
      }),
    )
  } else if (url.pathname === '/api/v1/organization/invitations') {
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    protectedCalls++
    res.end('[]')
  } else if (
    url.pathname === '/api/v1/organization/invitations/90000000-0000-0000-0000-000000000001/resend'
  ) {
    assert.equal(req.method, 'POST')
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    resends++
    res.writeHead(204).end()
  } else res.writeHead(404).end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const cdpPort = 19223
let child, browser
async function open() {
  child = spawn(
    path.resolve('desktop/CepHoras.Desktop/bin/Debug/net10.0-windows/CepHoras.exe'),
    [],
    {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CEP_API_URL: live ? 'http://127.0.0.1:8080' : `http://127.0.0.1:${port}`,
        CEP_SESSION_DIR: sessionDirectory,
        CEP_DESKTOP_TESTING: '1',
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
        WEBVIEW2_USER_DATA_FOLDER: path.join(working, 'profile'),
      },
    },
  )
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Desktop exited with ${child.exitCode}`)
    try {
      if ((await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok) {
        ready = true
        break
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  assert.ok(ready, 'WebView2 debugging endpoint did not start')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const context = browser.contexts()[0]
  return context.pages()[0] || (await context.waitForEvent('page'))
}
async function close() {
  await browser?.close()
  browser = undefined
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    await exited
  }
}
async function bridgeApi(page, payload) {
  return page.evaluate(
    (request) =>
      new Promise((resolve) => {
        const id = crypto.randomUUID()
        const listener = (event) => {
          if (event.data.id === id) {
            window.chrome.webview.removeEventListener('message', listener)
            resolve(event.data)
          }
        }
        window.chrome.webview.addEventListener('message', listener)
        window.chrome.webview.postMessage({
          type: 'cep-auth',
          documentId: window.__CEP_DOCUMENT_ID__,
          id,
          operation: 'api',
          payload: request,
        })
      }),
    payload,
  )
}
async function nativeAction(page, action) {
  await page.evaluate(
    (value) => window.chrome.webview.postMessage({ type: 'cep-desktop-test', action: value }),
    action,
  )
}
async function nativeEvents() {
  return (
    await readFile(path.join(sessionDirectory, 'native-ui.events'), 'utf8').catch(() => '')
  ).split(/\r?\n/)
}
async function waitNativeEvent(value, timeout = 5000) {
  for (const deadline = Date.now() + timeout; Date.now() < deadline;) {
    if ((await nativeEvents()).includes(value)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`Missing native event: ${value}`)
}
async function nativeUiState(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const id = crypto.randomUUID()
        const listener = (event) => {
          if (event.data.id !== id) return
          window.chrome.webview.removeEventListener('message', listener)
          resolve(event.data.result)
        }
        window.chrome.webview.addEventListener('message', listener)
        window.chrome.webview.postMessage({ type: 'cep-desktop-test', action: 'ui-state', id })
      }),
  )
}
try {
  let page = await open()
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  await waitNativeEvent('webview-loading')
  await waitNativeEvent('webview-ready')
  assert.deepEqual(await nativeUiState(page), {
    loading: false,
    recovery: false,
    browser: true,
    reloadEnabled: true,
  })
  // HTML navigation can succeed while React is empty. Verify native recovery
  // after removing the rendered interface, without touching the installed app.
  await page.evaluate(() => document.getElementById('root').replaceChildren())
  await waitNativeEvent('webview-rendered-root-empty')
  assert.deepEqual(await nativeUiState(page), {
    loading: false,
    recovery: true,
    browser: false,
    reloadEnabled: true,
  })
  const recovered = page.waitForEvent('domcontentloaded')
  await nativeAction(page, 'reload-ui')
  await recovered
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  assert.ok((await nativeEvents()).filter((event) => event === 'webview-loading').length >= 2)
  for (
    let attempt = 0;
    attempt < 50 && (await nativeEvents()).filter((event) => event === 'webview-ready').length < 2;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(
    (await nativeEvents()).filter((event) => event === 'webview-ready').length >= 2,
    'the native host waits for the restored React interface',
  )
  // Successful HTML navigation with no React must retain the native loading UI,
  // then time out to a usable recovery button rather than show a blank browser.
  const emptyUrl = `https://app.cephoras.local/${emptyFixtureName}`
  await page.goto(emptyUrl)
  assert.deepEqual(await nativeUiState(page), {
    loading: true,
    recovery: true,
    browser: false,
    reloadEnabled: true,
  })
  await waitNativeEvent('webview-loading-timeout', 35000)
  assert.deepEqual(await nativeUiState(page), {
    loading: false,
    recovery: true,
    browser: false,
    reloadEnabled: true,
  })
  const afterTimeout = page.waitForEvent('domcontentloaded')
  await nativeAction(page, 'reload-ui')
  await afterTimeout
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  console.log('PASS: WPF loading, blank React detection and reload recovery in isolated WebView2.')
  // A blocked renderer cannot reply over the bridge. The native timer must
  // detect it while remaining responsive and reload after the finite deadline.
  for (let attempt = 0; attempt < 80 && !(await nativeUiState(page)).browser; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal((await nativeUiState(page)).browser, true, 'the fault starts after native readiness')
  await nativeAction(page, 'reset-recovery-budget')
  await page.evaluate(() => {
    setTimeout(() => {
      const until = performance.now() + 9_000
      while (performance.now() < until) {
        /* isolated renderer fault fixture */
      }
    }, 0)
  })
  await waitNativeEvent('webview-renderer-unresponsive', 15000)
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  await page.waitForFunction(() => !!window.chrome?.webview)
  for (let attempt = 0; attempt < 80 && (await nativeUiState(page)).loading; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal((await nativeUiState(page)).browser, true)
  // A renderer fault during a download defers recovery, then resumes once
  // failure releases maintenance. No MSI, service or privileged action runs.
  const emptyFailures = (await nativeEvents()).filter(
    (event) => event === 'webview-rendered-root-empty',
  ).length
  await nativeAction(page, 'reset-recovery-budget')
  await nativeAction(page, 'update-downloading')
  await page.evaluate(() => document.getElementById('root').replaceChildren())
  for (let attempt = 0; attempt < 80; attempt++) {
    if (
      (await nativeEvents()).filter((event) => event === 'webview-rendered-root-empty').length >
      emptyFailures
    )
      break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal((await nativeUiState(page)).browser, false)
  assert.equal((await nativeUiState(page)).reloadEnabled, false)
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  await nativeAction(page, 'update-failed')
  await waitNativeEvent('webview-update-recovery-resumed')
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  for (let attempt = 0; attempt < 80 && !(await nativeUiState(page)).browser; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal((await nativeUiState(page)).browser, true)
  assert.equal((await nativeUiState(page)).reloadEnabled, true)
  console.log('PASS: renderer recovery resumes after a failed disposable update download.')
  // Native messages remain active while hidden; renderer timer throttling must
  // not be confused with network/API health or suspended machine elapsed time.
  await nativeAction(page, 'hide')
  await nativeAction(page, 'resume-ui')
  await new Promise((resolve) => setTimeout(resolve, 7000))
  assert.equal(
    (await nativeUiState(page)).browser,
    true,
    'a healthy tray renderer must remain healthy',
  )
  await nativeAction(page, 'open-inbox')
  // Recreate the control with the same owned UDF, then attach to the replacement
  // CDP target. This path must never replace or delete the DPAPI session folder.
  const previousProfile = path.join(working, 'profile')
  await nativeAction(page, 'recreate-ui')
  await waitNativeEvent('webview-recovery-recreate', 15000)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  page = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].waitForEvent('page'))
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  assert.ok(
    (await readdir(previousProfile)).includes('.cep-profile-owner'),
    'recreation preserves the same owned profile',
  )
  console.log(
    'PASS: blocked JS detection, tray/resume grace and browser recreation preserve the owned UDF.',
  )
  assert.equal(await page.evaluate(() => window.__CEP_DESKTOP__), true)
  await page.screenshot({ path: '.local/login-webview2.png', fullPage: true })
  await page.evaluate(() => {
    window.testMessages = []
    window.chrome.webview.addEventListener('message', (e) =>
      window.testMessages.push(JSON.stringify(e.data)),
    )
  })
  await page
    .getByLabel('E-mail corporativo', { exact: true })
    .fill(live ? `cep-ui-check-${Date.now()}@example.invalid` : user.email)
  await page.getByLabel('Senha', { exact: true }).fill('Fixture-password-123')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  if (live) {
    await page.getByRole('alert').filter({ hasText: 'E-mail ou senha inválidos' }).waitFor()
    console.log(
      'PASS: actual WebView2 → native HTTP → local CEP API rejected a nonexistent test account.',
    )
  } else {
    await page.getByRole('heading', { name: 'Minhas notificações', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Pessoas', exact: true }).click()
    await page.getByRole('heading', { name: 'Pessoas', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Sua lista de pessoas começa aqui' }).waitFor()
    assert.equal(loginBody.client.type, 'cep-horas-desktop')
    assert.equal(refreshes, 1)
    assert.ok(protectedCalls >= 2)
    assert.deepEqual(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0],
    )
    assert.equal(
      await page.evaluate(() =>
        window.testMessages.some((m) => /fixture-(access|refresh)/.test(m)),
      ),
      false,
    )
    const files = (await readdir(sessionDirectory)).filter((f) => f.endsWith('.dat'))
    assert.equal(files.length, 1)
    const encrypted = await readFile(path.join(sessionDirectory, files[0]))
    assert.ok(encrypted.length > 0)
    assert.equal(encrypted.includes(Buffer.from('fixture-refresh')), false)
    for (let attempt = 0; attempt < 100 && deliveredNotifications.size < 101; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(deliveredNotifications.size, 101, 'the native host recovers every pending page')
    assert.deepEqual(pendingPages.slice(0, 2), [1, 2])
    const ledgers = (await readdir(sessionDirectory)).filter((file) =>
      file.endsWith('.notifications'),
    )
    assert.equal(ledgers.length, 1)
    const ledger = await readFile(path.join(sessionDirectory, ledgers[0]))
    assert.equal(
      ledger.includes(Buffer.from(notificationIds[0])),
      false,
      'receipt ledger is DPAPI protected',
    )
    await waitNativeEvent('notification-summary-requested')
    await nativeAction(page, 'hide')
    await waitNativeEvent('hidden-to-tray')
    assert.equal(child.exitCode, null, 'closing the window must keep the app running in the tray')
    await nativeAction(page, 'popup')
    await waitNativeEvent('test-popup-requested')
    await nativeAction(page, 'open-inbox')
    await waitNativeEvent('opened-inbox')
    await page.getByRole('heading', { name: 'Minhas notificações', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Pessoas', exact: true }).click()
    const denied = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const id = crypto.randomUUID()
          const listener = (e) => {
            if (e.data.id === id) {
              window.chrome.webview.removeEventListener('message', listener)
              resolve(e.data)
            }
          }
          window.chrome.webview.addEventListener('message', listener)
          window.chrome.webview.postMessage({
            type: 'cep-auth',
            documentId: window.__CEP_DOCUMENT_ID__,
            id,
            operation: 'api',
            payload: { method: 'GET', path: '/system/organizations' },
          })
        }),
    )
    assert.equal(denied.error.code, 'unsupported_route')
    assert.equal(
      (await bridgeApi(page, { method: 'GET', path: '/organization/audit?pageSize=50' })).ok,
      true,
    )
    assert.equal(
      (
        await bridgeApi(page, {
          method: 'PATCH',
          path: `/organization/users/${user.id}`,
          body: {
            displayName: user.displayName,
            role: user.role,
            status: user.status,
            products: [],
          },
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await bridgeApi(page, {
          method: 'POST',
          path: '/organization/invitations',
          body: { email: 'new@example.invalid', role: 'organizationAdmin', products: [] },
        })
      ).ok,
      true,
    )
    assert.equal(
      (await bridgeApi(page, { method: 'PATCH', path: '/organization/users/not-a-guid', body: {} }))
        .error.code,
      'unsupported_route',
    )
    assert.equal(audits, 1)
    assert.equal(userPatches, 1)
    assert.equal(adminInvites, 1)
    const resend = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const id = crypto.randomUUID()
          const listener = (e) => {
            if (e.data.id === id) {
              window.chrome.webview.removeEventListener('message', listener)
              resolve(e.data)
            }
          }
          window.chrome.webview.addEventListener('message', listener)
          window.chrome.webview.postMessage({
            type: 'cep-auth',
            documentId: window.__CEP_DOCUMENT_ID__,
            id,
            operation: 'api',
            payload: {
              method: 'POST',
              path: '/organization/invitations/90000000-0000-0000-0000-000000000001/resend',
            },
          })
        }),
    )
    assert.equal(resend.ok, true)
    assert.equal(resends, 1)
    await close()
    page = await open()
    await page.getByRole('heading', { name: 'Pessoas', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Sua lista de pessoas começa aqui' }).waitFor()
    assert.equal(refreshes, 2, 'restore must rotate the persisted token exactly once')
    assert.equal(deliveredNotifications.size, 101, 'restart must not create duplicate deliveries')
    await page.getByRole('button', { name: 'Sair da conta' }).click()
    await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
    assert.equal(logoutBody.refreshToken, 'fixture-refresh-2')
    assert.equal((await readdir(sessionDirectory)).filter((f) => f.endsWith('.dat')).length, 0)
    console.log(
      (await nativeEvents()).includes('popup-shown-by-windows')
        ? 'PASS: Windows reported that the native popup was shown.'
        : 'NOTE: native popup requested; Windows did not report display (notification policy may suppress it).',
    )
    await nativeAction(page, 'exit')
    if (child.exitCode === null)
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Sair did not terminate the desktop')), 5000),
        ),
      ])
    console.log(
      'PASS: real WPF/WebView2 admin, protected API, single refresh, DPAPI restart/restore, route allowlist, token isolation and logout against disposable fixture.',
    )
  }
} finally {
  await close()
  server.close()
  await unlink(emptyFixturePath)
}
