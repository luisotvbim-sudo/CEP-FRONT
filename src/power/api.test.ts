import { describe, expect, it, vi } from 'vitest'
import { AuthError, type AuthClient } from '../auth/auth-client'
import { parsePowerCheck, PowerApi, validPowerPin } from './api'
import { unlockRemaining, unlockTime, unlockWindow } from './unlock-clock'
import { mayVerifyOffline, NativePowerBridge, NativePowerUncertain } from './native'
import type { WebViewBridge } from '../auth/desktop-auth-client'

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
const allowed = {
  action: 'shutdown',
  decision: 'allowed',
  code: 'within_tolerance',
  message: 'Liberado.',
  analysis,
  override: false,
  unlockedUntil: null,
}

describe('power contract', () => {
  it('accepts only coherent administrative overrides for the selected action', () => {
    const override = {
      ...allowed,
      code: 'administrative_override',
      override: true,
      unlockedUntil: '2026-10-01T12:05:00Z',
      analysis: null,
    }
    for (const action of ['shutdown', 'restart', 'hibernate'] as const)
      expect(parsePowerCheck({ ...override, action }, action).override).toBe(true)
    for (const value of [
      { ...override, override: false },
      { ...override, decision: 'blocked' },
      { ...override, unlockedUntil: null },
      { ...allowed, override: true },
      { ...allowed, unlockedUntil: '2026-10-01T12:05:00Z' },
    ])
      expect(() => parsePowerCheck(value, 'shutdown')).toThrow(AuthError)
  })
  it.each(['12345', '1234567', '12a456', '１２３４５６', ' 12345', '123456\n', ''])(
    'refuses invalid PIN format %# without sending',
    async (pin) => {
      expect(validPowerPin(pin)).toBe(false)
      const request = vi.fn()
      await expect(new PowerApi({ request } as unknown as AuthClient).unlock(pin)).rejects.toThrow(
        '6 dígitos',
      )
      expect(request).not.toHaveBeenCalled()
    },
  )
  it('sends a fixture PIN only in the exact POST body and validates the five-minute server duration', async () => {
    const result = {
      override: true,
      serverTime: '2026-10-01T12:00:00Z',
      unlockedUntil: '2026-10-01T12:05:00Z',
    }
    const request = vi.fn().mockResolvedValue(result)
    const api = new PowerApi({ request } as unknown as AuthClient)
    expect(await api.unlock('012345')).toEqual(result)
    expect(request.mock.calls).toEqual([
      ['POST', '/me/time-control/power-action-unlock', { pin: '012345' }],
    ])
    for (const value of [
      null,
      {},
      { ...result, override: false },
      { ...result, unlockedUntil: '2026-10-01T12:10:00Z' },
    ]) {
      request.mockResolvedValueOnce(value)
      await expect(api.unlock('012345')).rejects.toThrow('liberação inválida')
    }
  })
  it.each([403, 429, 503])('never turns unlock HTTP %i into offline', async (status) => {
    const error = new AuthError(
      'fixture',
      undefined,
      status === 503 ? 'power_pin_not_configured' : 'invalid_admin_pin',
      status,
    )
    const api = new PowerApi({ request: vi.fn().mockRejectedValue(error) } as unknown as AuthClient)
    await expect(api.unlock('012345')).rejects.toBe(error)
    expect(mayVerifyOffline(error)).toBe(false)
    expect(mayVerifyOffline(new AuthError('fixture', undefined, 'connection_failed', status))).toBe(
      false,
    )
  })
  it('uses server timestamps, deducts transport time and expires on monotonic time', () => {
    const result = {
      override: true,
      serverTime: '2026-10-01T12:00:00Z',
      unlockedUntil: '2026-10-01T12:05:00Z',
    }
    const window = unlockWindow(result, 1000, 6000)
    expect(unlockRemaining(window, 6000)).toBe(295)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    expect(unlockTime(unlockRemaining(window, 300_000))).toBe('0:01')
    clock.mockReturnValue(9_999_999_999_999)
    expect(unlockRemaining(window, 301_000)).toBe(0)
    expect(unlockRemaining(window, 500_000)).toBe(0)
    clock.mockRestore()
  })
  it('preserves the server decision at the exact tolerance and partial day', () => {
    expect(parsePowerCheck(allowed, 'shutdown')).toEqual(allowed)
    expect(
      parsePowerCheck({ ...allowed, decision: 'blocked', code: 'above_tolerance' }, 'shutdown')
        .decision,
    ).toBe('blocked')
    expect(
      parsePowerCheck(
        {
          ...allowed,
          decision: 'indeterminate',
          code: 'workforce_person_not_associated',
          analysis: null,
        },
        'shutdown',
      ).analysis,
    ).toBeNull()
  })
  it.each([
    null,
    {},
    { ...allowed, action: 'restart' },
    { ...allowed, decision: 'ok' },
    { ...allowed, decision: 'allowed', code: 'above_tolerance' },
    { ...allowed, analysis: null },
    { ...allowed, analysis: { ...analysis, deltaSeconds: undefined } },
  ])('refuses invalid response %#', (value) => {
    expect(() => parsePowerCheck(value, 'shutdown')).toThrow(AuthError)
  })
  it('uses only the authenticated own-person routes and forwards the selected action', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...allowed, action: 'hibernate' })
      .mockResolvedValueOnce(allowed)
    const api = new PowerApi({ request } as unknown as AuthClient)
    await api.check('hibernate')
    await api.status()
    expect(request.mock.calls).toEqual([
      ['POST', '/me/time-control/power-action-check', { action: 'hibernate' }],
      ['GET', '/me/time-control/power-action-status?action=shutdown'],
    ])
  })
  it.each([400, 401, 403, 429, 500])(
    'does not treat HTTP %i as offline even with transport code',
    (status) => {
      expect(mayVerifyOffline(new AuthError('error', undefined, 'connection_failed', status))).toBe(
        false,
      )
    },
  )
  it('only permits native verification for explicit transport failures', () => {
    expect(mayVerifyOffline(new AuthError('offline', undefined, 'connection_failed'))).toBe(true)
    for (const code of [
      'invalid_power_response',
      'above_tolerance',
      'analysis_incomplete',
      'desktop_request_failed',
      'native_power_timeout',
    ])
      expect(mayVerifyOffline(new AuthError('error', undefined, code))).toBe(false)
    expect(mayVerifyOffline(new TypeError('Failed to fetch'))).toBe(false)
  })
})

function nativeFixture(reply: (message: any) => unknown) {
  const listeners = new Set<Parameters<WebViewBridge['addEventListener']>[1]>()
  const messages: any[] = []
  const bridge: WebViewBridge = {
    addEventListener: (_, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_, listener) => {
      listeners.delete(listener)
    },
    postMessage: (message) => {
      messages.push(message)
      const m = message as any
      const result = reply(m)
      queueMicrotask(() =>
        listeners.forEach((listener) => listener({ data: { id: m.id, ok: true, result } })),
      )
    },
  }
  return { host: new NativePowerBridge(bridge), messages, listeners }
}

describe('native power adapter', () => {
  it('schedules ten seconds in the native host, then aborts the same ID', async () => {
    const f = nativeFixture((m) =>
      m.operation === 'schedule'
        ? {
            requestId: m.payload.requestId,
            action: m.payload.action,
            executeAt: new Date(Date.now() + 10_000).toISOString(),
          }
        : { cancelled: true },
    )
    const job = await f.host.schedule('shutdown', {
      kind: 'api',
      check: parsePowerCheck(allowed, 'shutdown'),
    })
    await f.host.cancel(job.requestId)
    expect(f.messages.map((m) => m.operation)).toEqual(['schedule', 'cancel'])
    expect(f.messages[0]).toMatchObject({
      type: 'cep-power',
      payload: { delaySeconds: 10, action: 'shutdown', authorization: { kind: 'api' } },
    })
    expect(f.messages[1].payload).toEqual({ requestId: job.requestId })
    expect(f.listeners.size).toBe(0)
  })
  it('does not accept generic truthy replies as verified offline or cancellation', async () => {
    const f = nativeFixture(() => ({ unreachable: 'true', cancelled: false }))
    expect(await f.host.verifyApiUnreachable()).toBe(false)
    await expect(f.host.cancel('job')).rejects.toThrow('cancelamento não foi confirmado')
  })
  it('aborts malformed native schedules without manufacturing a countdown', async () => {
    const f = nativeFixture((m) =>
      m.operation === 'schedule' ? { executeAt: new Date().toISOString() } : { cancelled: true },
    )
    await expect(f.host.schedule('restart', { kind: 'api-unreachable' })).rejects.toThrow(
      'agendamento inválido',
    )
    expect(f.messages.map((m) => m.operation)).toEqual(['schedule', 'cancel'])
  })
  it('retains an ID for retrying cancellation when scheduling is uncertain', async () => {
    const f = nativeFixture(() => null)
    await expect(f.host.schedule('hibernate', { kind: 'api-unreachable' })).rejects.toBeInstanceOf(
      NativePowerUncertain,
    )
    expect(f.messages[0].payload.requestId).toBe(f.messages[1].payload.requestId)
  })
})
