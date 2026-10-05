import { describe, expect, it, vi } from 'vitest'
import { AuthError, type AuthClient } from '../auth/auth-client'
import { OverviewApi } from './overview-api'
import { personalOverview } from './overview-fixture'

function setup(request: AuthClient['request']) {
  let expire = () => {}
  const client = {
    request,
    onExpired: (listener: () => void) => {
      expire = listener
      return () => {}
    },
  } as AuthClient
  return { api: new OverviewApi(client), expire: () => expire() }
}

describe('personal overview requests', () => {
  it('deduplicates equivalent queries and serializes source reads', async () => {
    let resolve!: (value: unknown) => void
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      )
      .mockResolvedValueOnce(personalOverview('regular', 'sprint'))
    const { api } = setup(request)
    const first = api.load('daily')
    expect(api.load('daily')).toBe(first)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    const obsolete = api.load('weekly').catch((error) => error)
    const last = api.load('sprint')
    expect(request).toHaveBeenCalledTimes(1)
    resolve(personalOverview())
    await first
    expect((await obsolete).code).toBe('overview_superseded')
    expect((await last).period).toBe('sprint')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('does not treat old API as transport offline and respects retry-after', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new AuthError('old', undefined, undefined, 404))
      .mockRejectedValueOnce(new AuthError('wait', undefined, undefined, 429, false, 120))
    const { api } = setup(request)
    await expect(api.load('daily')).rejects.toMatchObject({ status: 404, transportFailure: false })
    await expect(api.load('daily')).rejects.toMatchObject({ status: 429 })
    await expect(api.load('weekly')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 120 })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('rejects a result completed after session expiration and malformed contracts', async () => {
    let resolve!: (value: unknown) => void
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      )
      .mockResolvedValueOnce({ status: 'regular' })
    const { api, expire } = setup(request)
    const result = api.load('daily')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expire()
    resolve(personalOverview())
    await expect(result).rejects.toMatchObject({ code: 'session_expired' })
    await expect(api.load('daily')).rejects.toMatchObject({ code: 'invalid_overview' })
  })
})
