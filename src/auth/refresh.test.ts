import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpAuthClient } from './auth-client'

const credentials = { email: 'fixture@example.invalid', password: 'test-only' }
const user = { id: 'fixture', role: 'organizationAdmin', organizationId: 'fixture-org' }
function tokens(access: string, refresh: string) {
  return {
    accessToken: access,
    refreshToken: refresh,
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    user,
  }
}
afterEach(() => vi.useRealTimers())

describe('rotating sessions', () => {
  it('serializes refresh across concurrent protected requests and uses only the replacement token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let refreshes = 0
    const sent: string[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/auth/login')) return Response.json(tokens('access-1', 'refresh-1'))
      if (String(url).endsWith('/me')) return Response.json(user)
      if (String(url).endsWith('/auth/refresh')) {
        refreshes++
        expect(JSON.parse(init?.body as string)).toEqual({ refreshToken: 'refresh-1' })
        await new Promise((resolve) => setTimeout(resolve, 20))
        return Response.json(tokens('access-2', 'refresh-2'))
      }
      if (String(url).endsWith('/auth/logout')) {
        expect(JSON.parse(init?.body as string)).toEqual({ refreshToken: 'refresh-2' })
        return new Response(null, { status: 204 })
      }
      sent.push((init?.headers as Record<string, string>).Authorization)
      return Response.json({ items: [] })
    })
    const client = new HttpAuthClient(fetcher)
    await client.login(credentials)
    vi.setSystemTime(Date.now() + 40_000)
    await Promise.all([
      client.request('GET', '/organization/users'),
      client.request('GET', '/organization/time-control/people'),
      client.request('GET', '/organization/invitations'),
    ])
    expect(refreshes).toBe(1)
    expect(sent).toEqual(['Bearer access-2', 'Bearer access-2', 'Bearer access-2'])
    await client.logout()
  })

  it('does not replay a refresh token after a lost response and allows a new login', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let calls = 0
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/auth/login')) return Response.json(tokens('access', 'refresh'))
      if (String(url).endsWith('/me')) return Response.json(user)
      if (String(url).endsWith('/auth/refresh')) {
        calls++
        throw new TypeError('connection lost')
      }
      return Response.json({ items: [] })
    })
    const client = new HttpAuthClient(fetcher)
    const expired = vi.fn()
    client.onExpired(expired)
    await client.login(credentials)
    vi.setSystemTime(Date.now() + 40_000)
    await expect(client.request('GET', '/organization/users')).rejects.toMatchObject({
      code: 'session_expired',
    })
    await expect(client.request('GET', '/organization/users')).rejects.toMatchObject({
      code: 'session_expired',
    })
    expect(calls).toBe(1)
    expect(expired).toHaveBeenCalled()
    await expect(client.login(credentials)).resolves.toMatchObject({ user })
  })

  it('does not retry mutations on connection failure or access denied', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tokens('a', 'r')))
      .mockResolvedValueOnce(Response.json(user))
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(Response.json({ code: 'forbidden' }, { status: 403 }))
    const client = new HttpAuthClient(fetcher)
    await client.login(credentials)
    await expect(
      client.request('POST', '/organization/time-control/people/invitations', {}),
    ).rejects.toMatchObject({ code: 'connection_failed' })
    await expect(client.request('GET', '/organization/users')).rejects.toMatchObject({
      status: 403,
    })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
})
