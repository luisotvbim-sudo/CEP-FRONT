import type { components } from '../auth/api-schema'
import { AuthError, type AuthClient } from '../auth/auth-client'

export type PowerCheck = components['schemas']['PowerActionCheckResponse']
export type PowerAction = PowerCheck['action']
export type PowerUnlock = components['schemas']['PowerActionUnlockResponse']
export const validPowerPin = (pin: string) => pin.length === 6 && /^[0-9]{6}$/.test(pin)
export const actionLabels: Record<PowerAction, string> = {
  shutdown: 'Desligar',
  restart: 'Reiniciar',
  hibernate: 'Hibernar',
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const seconds = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value))
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

// Fail closed on malformed responses. Decisions and arithmetic belong to the API.
export function parsePowerCheck(value: unknown, action: PowerAction): PowerCheck {
  const invalid = () => {
    throw new AuthError(
      'A API retornou uma resposta inválida. Tente verificar novamente.',
      undefined,
      'invalid_power_response',
    )
  }
  if (
    !object(value) ||
    value.action !== action ||
    typeof value.message !== 'string' ||
    !value.message.trim()
  )
    return invalid()
  const codes: Record<string, string[]> = {
    allowed: ['within_tolerance', 'administrative_override'],
    blocked: ['above_tolerance'],
    indeterminate: [
      'analysis_incomplete',
      'workforce_person_not_associated',
      'external_identity_inactive',
    ],
  }
  if (
    typeof value.decision !== 'string' ||
    typeof value.code !== 'string' ||
    !codes[value.decision]?.includes(value.code)
  )
    return invalid()
  if (value.code === 'administrative_override') {
    if (value.override !== true || !date(value.unlockedUntil) || value.analysis !== null)
      return invalid()
    return value as PowerCheck
  }
  if (value.override !== false || value.unlockedUntil !== null) return invalid()
  const a = value.analysis
  if (a === null && value.decision === 'indeterminate') return value as PowerCheck
  if (
    !object(a) ||
    !date(a.from) ||
    !date(a.to) ||
    !date(a.cutoff) ||
    typeof a.settingsVersion !== 'string' ||
    !a.settingsVersion ||
    !Number.isInteger(a.toleranceMinutes) ||
    (a.toleranceMinutes as number) < 0 ||
    !seconds(a.vrSeconds) ||
    !seconds(a.mondaySeconds) ||
    !seconds(a.deltaSeconds) ||
    !seconds(a.absoluteDivergenceSeconds) ||
    typeof a.hasIssues !== 'boolean' ||
    !Array.isArray(a.days) ||
    !a.days.every(
      (d) =>
        object(d) &&
        date(d.day) &&
        seconds(d.vrSeconds) &&
        seconds(d.mondaySeconds) &&
        seconds(d.deltaSeconds) &&
        typeof d.partial === 'boolean' &&
        strings(d.issues),
    ) ||
    !Array.isArray(a.sources) ||
    !a.sources.every(
      (s) =>
        object(s) &&
        (s.source === 'monday' || s.source === 'vrMais') &&
        (s.status === 'complete' || s.status === 'incomplete') &&
        (s.errorCode === null || typeof s.errorCode === 'string') &&
        date(s.observedAt),
    )
  )
    return invalid()
  return value as PowerCheck
}

export class PowerApi {
  constructor(private readonly client: AuthClient) {}
  async check(action: PowerAction) {
    return parsePowerCheck(
      await this.client.request('POST', '/me/time-control/power-action-check', { action }),
      action,
    )
  }
  async status() {
    return parsePowerCheck(
      await this.client.request('GET', '/me/time-control/power-action-status?action=shutdown'),
      'shutdown',
    )
  }
  async unlock(pin: string): Promise<PowerUnlock> {
    if (!validPowerPin(pin)) throw new AuthError('Informe exatamente 6 dígitos numéricos.')
    const result = await this.client.request<unknown>(
      'POST',
      '/me/time-control/power-action-unlock',
      { pin },
    )
    if (
      !object(result) ||
      result.override !== true ||
      !date(result.serverTime) ||
      !date(result.unlockedUntil) ||
      Date.parse(result.unlockedUntil as string) - Date.parse(result.serverTime as string) !==
        300_000
    )
      throw new AuthError(
        'A API retornou uma liberação inválida. Verifique o status novamente.',
        undefined,
        'invalid_power_response',
      )
    return result as PowerUnlock
  }
}
