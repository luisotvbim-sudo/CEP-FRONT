import type { Invitation, Person } from './api'

export const zone = 'America/Sao_Paulo'
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
export function date(value?: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split('-').reverse().join('/')
    : 'Indisponível'
}
export function timestamp(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Indisponível'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: zone,
  }).format(new Date(value))
}
export function duration(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return 'Indisponível'
  const value = Math.abs(Math.trunc(seconds))
  return `${seconds < 0 ? '−' : ''}${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor((value % 3600) / 60)).padStart(2, '0')}${value % 60 ? ':' + String(value % 60).padStart(2, '0') : ''}`
}
export function validatePeriod(from: string, to: string): string | null {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  if (!valid(from) || !valid(to) || to < from)
    return 'Informe datas válidas, com início anterior ou igual ao fim.'
  if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 60)
    return 'O período pode ter até 60 dias, incluindo a data inicial e a final.'
  return null
}
export function invitationState(person: Person, invitation?: Invitation, now = Date.now()) {
  if (person.userId || person.invitationAcceptedAt || invitation?.acceptedAt)
    return { label: 'Aceito', tone: 'good' }
  if (invitation?.revokedAt) return { label: 'Revogado', tone: 'neutral' }
  const expires = invitation?.expiresAt ?? person.invitationExpiresAt
  if (!person.invitationId) return { label: 'Sem convite', tone: 'neutral' }
  if (expires && Date.parse(expires) <= now) return { label: 'Expirado', tone: 'warning' }
  return { label: invitation ? 'Aguardando aceite' : 'Aceite não registrado', tone: 'warning' }
}
export const sourceLabel = (source?: string) =>
  source === 'monday' ? 'Monday' : source === 'vrMais' ? 'VR Mais' : 'Fonte indisponível'
export const syncLabels: Record<string, string> = {
  running: 'Em andamento',
  succeeded: 'Concluída',
  partiallySucceeded: 'Sucesso parcial',
  failed: 'Falhou',
}
export function httpsUrl(value?: string | null) {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
