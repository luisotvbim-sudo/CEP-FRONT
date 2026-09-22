import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'

// Disposable HTTP fixture only. --live tests rejection of a nonexistent account.
const live = process.argv.includes('--live')
const working = path.resolve('.local/desktop-test', `run-${Date.now()}`)
const sessionDirectory = path.join(working, 'sessions')
await mkdir(sessionDirectory, { recursive: true })
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
  protectedCalls = 0
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
  } else if (url.pathname === '/api/v1/organization/time-control/people') {
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    protectedCalls++
    res.end(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 12 }))
  } else if (url.pathname === '/api/v1/organization/invitations') {
    assert.equal(req.headers.authorization, `Bearer fixture-access-${refreshes}`)
    protectedCalls++
    res.end('[]')
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
try {
  let page = await open()
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
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
            id,
            operation: 'api',
            payload: { method: 'GET', path: '/system/organizations' },
          })
        }),
    )
    assert.equal(denied.error.code, 'unsupported_route')
    await close()
    page = await open()
    await page.getByRole('heading', { name: 'Pessoas', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Sua lista de pessoas começa aqui' }).waitFor()
    assert.equal(refreshes, 2, 'restore must rotate the persisted token exactly once')
    await page.getByRole('button', { name: 'Sair da conta' }).click()
    await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
    assert.equal(logoutBody.refreshToken, 'fixture-refresh-2')
    assert.equal((await readdir(sessionDirectory)).filter((f) => f.endsWith('.dat')).length, 0)
    console.log(
      'PASS: real WPF/WebView2 admin, protected API, single refresh, DPAPI restart/restore, route allowlist, token isolation and logout against disposable fixture.',
    )
  }
} finally {
  await close()
  server.close()
}
