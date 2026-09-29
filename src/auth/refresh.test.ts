import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpAuthClient } from './auth-client'

const credentials = { email: 'fixture@example.invalid', password: 'test-only' }
const user = { id: 'fixture', role: 'organizationAdmin', organizationId: 'fixture-org' }
function tokens(access: string) {
  return {
    accessToken: access,
    sessionExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    user,
  }
}
afterEach(() => vi.useRealTimers())

describe('rotating sessions', () => {
  it('does not resurrect cached restore results after logout', async () => {
    let active = true
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/auth/web/logout')) {
        active = false
        return new Response(null, { status: 204 })
      }
      if (String(url).endsWith('/auth/web/refresh'))
        return active
          ? Response.json(tokens('restored'))
          : Response.json({ code: 'session_expired' }, { status: 401 })
      return Response.json(user)
    })
    const client = new HttpAuthClient(fetcher)
    const first = client.restore()
    expect(client.restore()).toBe(first)
    await expect(first).resolves.toMatchObject({ user })
    await client.logout()
    await expect(client.restore()).resolves.toBeNull()
  })

  it('rejects a delayed protected response after logout instead of exposing the previous account data', async () => {
    let release!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/auth/web/login')) return Response.json(tokens('access'))
      if (String(url).endsWith('/me')) return Response.json(user)
      if (String(url).endsWith('/auth/web/logout')) return new Response(null, { status: 204 })
      return new Promise<Response>((resolve) => {
        release = resolve
      })
    })
    const client = new HttpAuthClient(fetcher)
    await client.login(credentials)
    const pending = client.request('GET', '/organization/users')
    const check = expect(pending).rejects.toMatchObject({ code: 'session_expired' })
    await client.logout()
    release(Response.json({ items: ['previous-account-data'] }))
    await check
  })

  it('retries a 401 once with a replacement access token and expires on repeated rejection', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tokens('old')))
      .mockResolvedValueOnce(Response.json(user))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json(tokens('new')))
      .mockResolvedValueOnce(Response.json({ correlationId: 'denied' }, { status: 401 }))
    const client = new HttpAuthClient(fetcher)
    const expired = vi.fn()
    client.onExpired(expired)
    await client.login(credentials)
    await expect(client.request('GET', '/organization/users')).rejects.toMatchObject({
      status: 401,
      correlationId: 'denied',
    })
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect((fetcher.mock.calls[4][1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer new',
    )
    expect(expired).toHaveBeenCalledOnce()
  })

  it('serializes refresh across concurrent protected requests and uses only the replacement token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let refreshes = 0
    const sent: string[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/auth/web/login')) return Response.json(tokens('access-1'))
      if (String(url).endsWith('/me')) return Response.json(user)
      if (String(url).endsWith('/auth/web/refresh')) {
        refreshes++
        expect(JSON.parse(init?.body as string)).toEqual({})
        await new Promise((resolve) => setTimeout(resolve, 20))
        return Response.json(tokens('access-2'))
      }
      if (String(url).endsWith('/auth/web/logout')) {
        expect(JSON.parse(init?.body as string)).toEqual({})
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
      if (String(url).endsWith('/auth/web/login')) return Response.json(tokens('access'))
      if (String(url).endsWith('/me')) return Response.json(user)
      if (String(url).endsWith('/auth/web/refresh')) {
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
      code: 'connection_failed',
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
      .mockResolvedValueOnce(Response.json(tokens('a')))
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
