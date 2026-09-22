import { describe, expect, it, vi } from 'vitest'
import { AuthError, HttpAuthClient } from './auth-client'

const session = () => ({
  accessToken: 'test-access-token',
  sessionExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
  accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: {
    id: 'test-id',
    displayName: 'Pessoa de teste',
    email: 'test@example.invalid',
    role: 'user',
  },
})

describe('HTTP authentication', () => {
  it('uses the API contract, trims only the email, and does not expose tokens to the UI', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(session()))
      .mockResolvedValueOnce(Response.json(session().user))
    const client = new HttpAuthClient(fetcher)
    const result = await client.login({
      email: ' test@example.invalid ',
      password: ' password with spaces ',
    })
    expect(result.user.id).toBe('test-id')
    expect(result).not.toHaveProperty('refreshToken')
    expect(result).not.toHaveProperty('accessToken')
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      email: 'test@example.invalid',
      password: ' password with spaces ',
      client: { type: 'cep-horas-web', version: '0.2.0' },
    })
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/web/login')
  })

  it.each([401, 403, 429, 500])(
    'handles HTTP %s without showing internal error details',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { detail: 'private database error', correlationId: 'trace-test' },
            { status },
          ),
        )
      await expect(
        new HttpAuthClient(fetcher).login({ email: 'test@example.invalid', password: 'test' }),
      ).rejects.toMatchObject({ name: 'AuthError', correlationId: 'trace-test' })
      const second = new HttpAuthClient(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json({ detail: 'private database error' }, { status })),
      )
      await expect(
        second.login({ email: 'test@example.invalid', password: 'test' }),
      ).rejects.not.toHaveProperty('message', 'private database error')
    },
  )

  it('handles non-JSON proxy errors and network failures', async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>().mockResolvedValue(new Response('Bad Gateway', { status: 502 })),
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network failure')),
    ]) {
      await expect(
        new HttpAuthClient(fetcher).login({ email: 'test@example.invalid', password: 'test' }),
      ).rejects.toBeInstanceOf(AuthError)
    }
  })

  it('rejects malformed or expired successful responses', async () => {
    for (const payload of [{}, { ...session(), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }]) {
      await expect(
        new HttpAuthClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))).login({
          email: 'test@example.invalid',
          password: 'test',
        }),
      ).rejects.toBeInstanceOf(AuthError)
    }
  })

  it('revokes the server session on logout and retains the token for retry after failure', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(session()))
      .mockResolvedValueOnce(Response.json(session().user))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = new HttpAuthClient(fetcher)
    await client.login({ email: 'test@example.invalid', password: 'test' })
    await expect(client.logout()).rejects.toBeInstanceOf(AuthError)
    await client.logout()
    expect(fetcher.mock.calls[3][0]).toBe('/api/v1/auth/web/logout')
    expect(JSON.parse(fetcher.mock.calls[3][1]?.body as string)).toEqual({})
    await client.logout()
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('requests password recovery through the existing endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }))
    await new HttpAuthClient(fetcher).requestPasswordReset(' test@example.invalid ')
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/password/forgot')
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      email: 'test@example.invalid',
    })
  })

  it('resets a password with the code and preserves spaces in the new password', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    await new HttpAuthClient(fetcher).resetPassword({
      email: ' test@example.invalid ',
      code: ' code ',
      newPassword: ' new password ',
    })
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/password/reset')
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      email: 'test@example.invalid',
      code: 'code',
      newPassword: ' new password ',
    })
  })
})
