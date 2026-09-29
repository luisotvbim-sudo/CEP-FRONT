import { describe, expect, it } from 'vitest'
import { apiFailure, describeError, errorMessage } from './errors'

describe('safe API errors', () => {
  it('uses the contract code before generic status messages and keeps support correlation', () => {
    const failure = apiFailure(409, {
      code: 'external_identity_already_mapped',
      correlationId: 'trace',
      detail: 'private SQL details',
    })
    expect(failure.message).toContain('já está associado')
    expect(failure).toMatchObject({
      code: 'external_identity_already_mapped',
      correlationId: 'trace',
      status: 409,
    })
    expect(errorMessage(failure)).toBe(failure)
    expect(failure.message).not.toContain('SQL')
  })
  it.each([null, 'proxy failed', 42, [], { code: {}, correlationId: 42 }])(
    'handles malformed ProblemDetails safely: %j',
    (body) => {
      const failure = apiFailure(502, body)
      expect(typeof failure.message).toBe('string')
      expect(failure.correlationId).toBeUndefined()
      expect(failure.code).toBeUndefined()
    },
  )
  it.each(['toString', '__proto__', 'constructor'])(
    'does not treat inherited property %s as a known code',
    (code) => {
      expect(describeError(500, { code })).toBe(
        'Não foi possível acessar o serviço. Tente novamente em instantes.',
      )
    },
  )
  it('does not leak an unexpected exception to the user', () => {
    expect(errorMessage(new Error('database secret')).message).not.toContain('database')
  })
})
