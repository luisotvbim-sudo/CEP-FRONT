import { AuthError, type AuthClient } from '../auth/auth-client'
import type { components } from '../auth/api-schema'

type Schema = components['schemas']
export type Overview = Required<Schema['PersonalOverviewResponse']>
export type OverviewStatus = Schema['PersonalOverviewStatus']
export type OverviewPeriod = Schema['AnalysisPeriod']

function validate(value: Overview): Overview {
  if (
    !value ||
    !['regular', 'difference', 'incomplete', 'notAssociated', 'inactiveIdentity'].includes(
      value.status,
    ) ||
    !Number.isFinite(Date.parse(value.cutoff)) ||
    !Array.isArray(value.periods) ||
    !value.periods.length ||
    !Array.isArray(value.attentionDays) ||
    !Array.isArray(value.availableSourceDays) ||
    !value.periods.some((item) => item.period === value.period) ||
    (!value.analysis && !['notAssociated', 'inactiveIdentity'].includes(value.status))
  )
    throw new AuthError(
      'A conferência retornou dados inesperados. Tente novamente.',
      undefined,
      'invalid_overview',
    )
  return value
}

export class OverviewApi {
  private flights = new Map<OverviewPeriod, Promise<Overview>>()
  private tail: Promise<unknown> = Promise.resolve()
  private desired: OverviewPeriod = 'daily'
  private epoch = 0
  private retryAt = 0

  constructor(private readonly client: AuthClient) {
    client.onExpired(() => {
      this.epoch++
      this.flights.clear()
      this.retryAt = 0
    })
  }

  load(period: OverviewPeriod): Promise<Overview> {
    this.desired = period
    const existing = this.flights.get(period)
    if (existing) return existing
    const epoch = this.epoch
    const flight = this.tail
      .catch(() => {})
      .then(async () => {
        if (epoch !== this.epoch || period !== this.desired)
          throw new AuthError('A seleção mudou.', undefined, 'overview_superseded')
        if (Date.now() < this.retryAt)
          throw new AuthError(
            'Aguarde antes de conferir novamente.',
            undefined,
            undefined,
            429,
            false,
            Math.ceil((this.retryAt - Date.now()) / 1000),
          )
        try {
          const value = validate(
            await this.client.request<Overview>(
              'GET',
              `/me/time-control/overview?period=${period}`,
            ),
          )
          if (epoch !== this.epoch)
            throw new AuthError('Entre novamente.', undefined, 'session_expired', 401)
          if (value.period !== period)
            throw new AuthError(
              'O período recebido é diferente do solicitado.',
              undefined,
              'invalid_overview',
            )
          return value
        } catch (error) {
          if (error instanceof AuthError && error.status === 429)
            this.retryAt = Date.now() + (error.retryAfterSeconds ?? 60) * 1000
          throw error
        }
      })
      .finally(() => {
        if (this.flights.get(period) === flight) this.flights.delete(period)
      })
    this.flights.set(period, flight)
    this.tail = flight
    return flight
  }
}

const clients = new WeakMap<AuthClient, OverviewApi>()
export function overviewApi(client: AuthClient) {
  let api = clients.get(client)
  if (!api) {
    api = new OverviewApi(client)
    clients.set(client, api)
  }
  return api
}
