import { describe, expect, it } from 'vitest'
import { AuthError } from '../auth/auth-client'
import { powerFailure } from './feedback'
import { NativePowerUncertain } from './native'

describe('public energy feedback', () => {
  it.each([
    ['invalid_admin_pin', 403, 'PIN administrativo recusado'],
    ['session_expired', 401, 'Entre novamente'],
    ['power_unlock_rate_limited', 429, 'Limite de tentativas'],
    ['power_pin_not_configured', 503, 'não está configurado'],
    ['invalid_power_response', undefined, 'não pôde ser validada'],
    ['invalid_native_response', undefined, 'não pôde ser validada'],
    ['connection_failed', undefined, 'não foi recebida'],
    ['desktop_request_failed', 503, 'não foi recebida'],
    ['desktop_timeout', undefined, 'não foi recebida'],
    ['unknown', 403, 'não está autorizada'],
    ['unknown', 500, 'indisponível'],
  ])('distinguishes %s without exposing exception text', (code, status, message) => {
    const result = powerFailure(
      new AuthError('private fixture payload', 'support-123', code, status),
      'unlock',
    )
    expect(result).toContain(message)
    expect(result).toContain('Código para suporte: support-123')
    expect(result).not.toContain('private fixture payload')
  })
  it('uses the server retry delay without automatically retrying', () => {
    expect(
      powerFailure(
        new AuthError('private', undefined, 'power_unlock_rate_limited', 429, false, 42),
        'unlock',
      ),
    ).toContain('42 segundos')
  })
  it.each(['unlock', 'action', 'cancel'] as const)(
    'sanitizes unknown errors for %s',
    (operation) => {
      for (const error of [
        new Error('private'),
        new AuthError('private', 'unsafe support payload'),
      ]) {
        const message = powerFailure(error, operation)
        expect(message).not.toContain('private')
        expect(message).not.toContain('unsafe support payload')
        expect(message).not.toContain('Código para suporte')
      }
    },
  )
  it.each([
    'power_service_unavailable',
    'power_service_timeout',
    'power_service_invalid_response',
    'update_maintenance',
    'access_denied',
    'service_error',
    'inactive',
    'power_not_authorized',
    'power_service_changed',
    'power_uncertain',
  ])('explains native refusal %s', (code) => {
    const message = powerFailure(new AuthError('private', undefined, code), 'action')
    expect(message).not.toContain('private')
    expect(message).not.toContain('A operação de energia não foi confirmada')
  })
  it('preserves uncertainty and directs explicit cancellation', () => {
    expect(powerFailure(new NativePowerUncertain(crypto.randomUUID()), 'cancel')).toContain(
      'Tente cancelar novamente',
    )
  })
  it('explains invalid JSON without echoing its parse error', () => {
    expect(powerFailure(new SyntaxError('private payload'), 'unlock')).toContain(
      'não pôde ser validada',
    )
  })
  it('rejects inherited message keys', () => {
    expect(powerFailure(new AuthError('private', undefined, '__proto__'), 'action')).toContain(
      'A operação de energia não foi confirmada',
    )
  })
})
