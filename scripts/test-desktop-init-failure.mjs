import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

assert.equal(process.platform, 'win32', 'This fixture requires the Windows Debug desktop host')
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = path.join(
  repository,
  'desktop/CepHoras.Desktop/bin/Debug/net10.0-windows/CepHoras.exe',
)
await access(executable)
const working = path.join(repository, '.local/desktop-init-failure', `run-${randomUUID()}`)
const sessions = path.join(working, 'sessions')
const profile = path.join(working, 'webview-profile')
const diagnosticsPath = path.join(sessions, 'Diagnostics/webview.jsonl')
const eventsPath = path.join(sessions, 'native-ui.events')
await mkdir(sessions, { recursive: true })

async function optionalText(filename) {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

async function diagnostics() {
  return (await optionalText(diagnosticsPath))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

let child
let evidence
try {
  // Invalid remote HTTP is rejected before ApiSession or WebView2 setup. No API,
  // managed-install marker, broker, credentials or energy request is involved.
  child = spawn(executable, [], {
    cwd: repository,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CEP_API_URL: 'http://example.invalid',
      CEP_SESSION_DIR: sessions,
      CEP_DESKTOP_TESTING: '1',
      WEBVIEW2_USER_DATA_FOLDER: profile,
    },
  })
  await once(child, 'spawn')
  const deadline = Date.now() + 15_000
  while (true) {
    assert.equal(child.exitCode, null, 'Host exited instead of retaining its native recovery panel')
    assert.equal(child.signalCode, null, 'Host stopped before the assertion window')
    if ((await optionalText(eventsPath)).includes('webview-host-initialization-failed')) break
    assert.ok(Date.now() < deadline, 'Missing host-initialization-failed diagnostic')
    await delay(100)
  }
  // Covers the previous first automatic recovery after one second, and checks
  // native state independently of a browser which must never have been created.
  await delay(2_200)
  const records = await diagnostics()
  const events = (await optionalText(eventsPath)).split(/\r?\n/).filter(Boolean)
  assert.equal(child.exitCode, null, 'Host exited while showing its setup failure')
  assert.equal(child.signalCode, null, 'Host was stopped while showing its setup failure')
  assert.ok(records.some((entry) => entry.code === 'host-initialization-failed'))
  const forbidden = records.filter(
    (entry) =>
      entry.code === 'ready' ||
      entry.code === 'navigation-completed' ||
      entry.code.startsWith('recovery-') ||
      entry.code === 'renderer-unresponsive' ||
      entry.code === 'process-failed' ||
      entry.code === 'bridge-failed',
  )
  assert.deepEqual(forbidden, [], 'Host setup failure was treated as a recoverable browser')
  assert.ok(
    !events.some((entry) =>
      /webview-(ready|navigation-completed|recovery-|renderer-unresponsive|process-failed|bridge-failed)/.test(
        entry,
      ),
    ),
    'Native events advertised browser readiness or recovery after host setup failure',
  )
  const files = await readdir(working)
  // App owns a startup gate before MainWindow setup. That empty sidecar is not
  // browser use; the UDF directory, host lease and reset/restart files are absent.
  assert.deepEqual(
    files.filter(
      (filename) =>
        filename.startsWith('webview-profile') && filename !== 'webview-profile.startup.lock',
    ),
    [],
    'Host setup failure opened or modified a WebView2 profile',
  )
  assert.deepEqual(await readdir(sessions), ['Diagnostics', 'native-ui.events'])
  evidence = {
    scenario: 'invalid remote HTTP rejected before native host setup',
    apiUrl: 'http://example.invalid',
    childPid: child.pid,
    observationAfterFailureMs: 2_200,
    checks: {
      hostFailureObserved: true,
      hostRetainedLive: true,
      noBrowserReadinessOrRecovery: true,
      noUserDataFolderUse: true,
      noApiSessionStorage: true,
    },
    diagnostics: records,
    nativeEvents: events,
  }
} finally {
  // A child-process handle identifies precisely this fixture. Never enumerate
  // applications or terminate by executable name, session or process tree.
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
    assert.ok(child.kill(), 'Could not stop the exact fixture child')
    await exited
  }
}

const report = path.join(working, 'evidence.json')
await writeFile(report, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
console.log(`PASS: host setup failure stays native without WebView2 recovery. Evidence: ${report}`)
