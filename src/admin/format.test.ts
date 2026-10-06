import { describe, expect, it } from 'vitest'
import { date, duration, httpsUrl, invitationState, mondayDifference, timestamp, validatePeriod } from './format'

describe('administrative display rules', () => {
  it('distinguishes unknown duration, zero and totals greater than 24 hours', () => {
    expect(duration(null)).toBe('Indisponível')
    expect(duration(0)).toBe('00:00')
    expect(duration(90061)).toBe('25:01:01')
  })
  it('uses VR Mais as the display reference for Monday differences', () => {
    expect(mondayDifference(3661)).toMatchObject({
      label: 'Sobrando no Monday',
      duration: '01:01:01',
      signedDuration: '+01:01:01',
    })
    expect(mondayDifference(-779)).toMatchObject({
      label: 'Faltando no Monday',
      duration: '00:12:59',
      signedDuration: '−00:12:59',
    })
    expect(mondayDifference(0)).toMatchObject({ label: 'Sem diferença', duration: '00:00' })
    expect(mondayDifference(null)).toMatchObject({
      label: 'Diferença indisponível',
      duration: 'Indisponível',
      known: false,
    })
  })
  it('enforces an inclusive 90-day period and real dates', () => {
    expect(validatePeriod('2026-01-01', '2026-03-31')).toBeNull()
    expect(validatePeriod('2026-01-01', '2026-04-01')).not.toBeNull()
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
