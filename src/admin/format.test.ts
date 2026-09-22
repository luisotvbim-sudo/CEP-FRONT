import { describe, expect, it } from 'vitest'
import { date, duration, httpsUrl, invitationState, timestamp, validatePeriod } from './format'

describe('administrative display rules', () => {
  it('distinguishes unknown duration, zero and totals greater than 24 hours', () => {
    expect(duration(null)).toBe('Indisponível')
    expect(duration(0)).toBe('00:00')
    expect(duration(90061)).toBe('25:01:01')
  })
  it('enforces an inclusive 60-day period and real dates', () => {
    expect(validatePeriod('2026-01-01', '2026-03-01')).toBeNull()
    expect(validatePeriod('2026-01-01', '2026-03-02')).not.toBeNull()
    expect(validatePeriod('2026-02-30', '2026-03-01')).not.toBeNull()
    expect(validatePeriod('2026-09-02', '2026-09-01')).not.toBeNull()
  })
  it('keeps date-only values and renders timestamps in São Paulo', () => {
    expect(date('2026-09-21')).toBe('21/09/2026')
    expect(timestamp('2026-09-21T01:00:00Z')).toContain('20/09/2026')
    expect(timestamp('2026-09-21T01:00:00Z')).toContain('22:00')
  })
  it('distinguishes accepted, revoked and expired invitations', () => {
    const person = { invitationId: 'i', invitationExpiresAt: '2026-09-01T00:00:00Z' }
    expect(invitationState(person, undefined, Date.parse('2026-09-02')).label).toBe('Expirado')
    expect(invitationState(person, { revokedAt: '2026-08-30' }).label).toBe('Revogado')
    expect(invitationState({ ...person, userId: 'u' }).label).toBe('Aceito')
  })
  it('does not offer unsafe external links', () => {
    expect(httpsUrl('javascript:alert(1)')).toBeNull()
    expect(httpsUrl('http://example.com')).toBeNull()
    expect(httpsUrl('https://example.com')).toBe('https://example.com/')
  })
})
