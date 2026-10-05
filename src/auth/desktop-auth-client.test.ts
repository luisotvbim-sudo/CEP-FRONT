import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopAuthClient, type WebViewBridge } from './desktop-auth-client'

function bridgeFixture() {
  type Listener = Parameters<WebViewBridge['addEventListener']>[1]
  const listeners = new Set<Listener>()
  const sent: { id: string; operation: string; payload: unknown }[] = []
  const bridge: WebViewBridge = {
    postMessage: (message) => {
      sent.push(message as (typeof sent)[number])
    },
    addEventListener: (_, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_, listener) => {
      listeners.delete(listener)
    },
  }
  return {
    bridge,
    sent,
    listeners,
    client: new DesktopAuthClient(bridge),
    reply: (data: Parameters<Listener>[0]['data']) => {
      for (const listener of [...listeners]) listener({ data })
    },
  }
}
afterEach(() => vi.useRealTimers())

describe('desktop bridge lifecycle', () => {
  it('distinguishes native transport failure from an HTTP 503 response', async () => {
    for (const transportFailure of [false, true]) {
      const f = bridgeFixture()
      const pending = f.client.request('POST', '/me/time-control/power-action-unlock', {
        pin: '012345',
      })
      const assertion = expect(pending).rejects.toMatchObject({ status: 503, transportFailure })
      f.reply({
        id: f.sent[0].id,
        ok: false,
        error: { status: 503, code: 'connection_failed', transportFailure },
      })
      await assertion
    }
  })
  it('correlates concurrent replies, ignores other messages, and removes listeners', async () => {
    const f = bridgeFixture()
    const first = f.client.request('GET', '/organization/users')
    const second = f.client.request('GET', '/organization/invitations')
    f.reply({ id: 'unrelated', ok: true, result: 'wrong' })
    f.reply({ id: f.sent[1].id, ok: true, result: ['second'] })
    f.reply({ id: f.sent[0].id, ok: true, result: ['first'] })
    expect(await first).toEqual(['first'])
    expect(await second).toEqual(['second'])
    expect(f.listeners.size).toBe(0)
  })
  it('deduplicates simultaneous restore, but permits retry after completion', async () => {
    const f = bridgeFixture()
    const first = f.client.restore()
    expect(f.client.restore()).toBe(first)
    expect(f.sent).toHaveLength(1)
    f.reply({ id: f.sent[0].id, ok: true, result: null })
    await first
    const retry = f.client.restore()
    expect(f.sent).toHaveLength(2)
    f.reply({ id: f.sent[1].id, ok: true, result: null })
    await retry
  })
  it('preserves ProblemDetails and expires only on the explicit session code', async () => {
    const f = bridgeFixture()
    const expired = vi.fn()
    const unsubscribe = f.client.onExpired(expired)
    const failed = f.client.request('GET', '/organization/users')
    const check = expect(failed).rejects.toMatchObject({
      status: 401,
      code: 'session_expired',
      correlationId: 'trace',
    })
    f.reply({
      id: f.sent[0].id,
      ok: false,
      error: { status: 401, code: 'session_expired', correlationId: 'trace' },
    })
    await check
    expect(expired).toHaveBeenCalledOnce()
    unsubscribe()
    expect(f.listeners.size).toBe(0)
  })
  it('cleans up after a timeout and does not replay the operation', async () => {
    vi.useFakeTimers()
    const f = bridgeFixture()
    const pending = f.client.requestPasswordReset('fixture@example.invalid')
    const check = expect(pending).rejects.toThrow('demorou')
    await vi.advanceTimersByTimeAsync(65_000)
    await check
    f.reply({ id: f.sent[0].id, ok: true })
    expect(f.sent).toHaveLength(1)
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not time out logout while the host is still within its cancellation/API budget', async () => {
    vi.useFakeTimers()
    const f = bridgeFixture()
    const pending = f.client.logout()
    await vi.advanceTimersByTimeAsync(35_000)
    expect(f.sent).toHaveLength(1)
    expect(f.listeners.size).toBe(1)
    f.reply({ id: f.sent[0].id, ok: true })
    await pending
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans up when the host rejects postMessage synchronously', async () => {
    vi.useFakeTimers()
    const f = bridgeFixture()
    f.bridge.postMessage = () => {
      throw new Error('host unavailable')
    }
    await expect(f.client.logout()).rejects.toThrow('comunicar')
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('normalizes invitation identifiers but never the password', async () => {
    const f = bridgeFixture()
    const pending = f.client.activateInvitation({
      email: ' a@example.invalid ',
      displayName: ' Ana ',
      code: ' 123 ',
      password: ' spaces stay ',
    })
    expect(f.sent[0].payload).toEqual({
      email: 'a@example.invalid',
      displayName: 'Ana',
      code: '123',
      password: ' spaces stay ',
    })
    f.reply({ id: f.sent[0].id, ok: true })
    await pending
  })
  it.each([
    { ok: 'true', result: {} },
    { ok: true, error: { code: 'conflicting' } },
    { ok: false, error: { status: '503' } },
    { ok: false, error: { transportFailure: 'true' } },
  ])('rejects malformed envelopes without expiring the session %#', async (data) => {
    const f = bridgeFixture()
    const expired = vi.fn()
    f.client.onExpired(expired)
    const pending = f.client.request('GET', '/me')
    const assertion = expect(pending).rejects.toMatchObject({ code: 'invalid_native_response' })
    f.reply({ id: f.sent[0].id, ...data } as Parameters<
      Parameters<WebViewBridge['addEventListener']>[1]
    >[0]['data'])
    await assertion
    expect(expired).not.toHaveBeenCalled()
    expect(f.listeners.size).toBe(0)
  })
  it('validates native session metadata before exposing it to the UI', async () => {
    const user = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'user' }
    const valid = { user, expiresAt: new Date(Date.now() + 60_000).toISOString() }
    for (const result of [
      undefined,
      {},
      { ...valid, user: { ...user, id: 'invalid' } },
      { ...valid, user: { ...user, role: 'superuser' } },
      { ...valid, expiresAt: '2000-01-01T00:00:00Z' },
      { ...valid, accessToken: 'fixture-only' },
    ]) {
      const f = bridgeFixture()
      const pending = f.client.restore()
      const assertion = expect(pending).rejects.toMatchObject({ code: 'invalid_session_response' })
      f.reply({ id: f.sent[0].id, ok: true, result })
      await assertion
      expect(f.listeners.size).toBe(0)
    }
    const f = bridgeFixture()
    const pending = f.client.login({ email: 'fixture@example.invalid', password: 'fixture-only' })
    f.reply({ id: f.sent[0].id, ok: true, result: valid })
    expect(await pending).toEqual(valid)
  })
})
