import { AuthError, apiFailure, errorMessage } from './errors'
export { AuthError, describeError, errorMessage } from './errors'
import type { components } from './api-schema'

export type User = components['schemas']['UserResponse']
type TokenResponse = components['schemas']['WebSessionResponse']
export type Credentials = { email: string; password: string }
export type ResetPassword = { email: string; code: string; newPassword: string }
export type ActivateInvitation = {
  email: string
  code: string
  displayName: string
  password: string
}
export type AuthSession = { user: User; expiresAt: string }

// The UI consumes this interface in the browser and in WebView2.
// A native host can provide an adapter without exposing tokens to React.
export interface AuthClient {
  login(credentials: Credentials): Promise<AuthSession>
  logout(): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  resetPassword(input: ResetPassword): Promise<void>
  activateInvitation(input: ActivateInvitation): Promise<void>
  restore(): Promise<AuthSession | null>
  request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object): Promise<T>
  onExpired(listener: (error?: AuthError) => void): () => void
}

export class HttpAuthClient implements AuthClient {
  private hasSession = false
  private user: User | null = null
  private accessToken: string | null = null
  private expiresAt = 0
  private restoreFlight: Promise<AuthSession | null> | null = null
  private refreshFlight: Promise<void> | null = null
  private epoch = 0
  private listeners = new Set<(error?: AuthError) => void>()
  private readonly channel =
    typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('cep-web-session')
      : null

  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = '/api/v1',
  ) {
    this.channel?.addEventListener('message', () => this.expire())
  }

  private async withSessionLock<T>(action: () => Promise<T>): Promise<T> {
    // The cookie is shared by tabs: serialize the whole request, including Set-Cookie.
    if (typeof window !== 'undefined') {
      if (!navigator.locks)
        throw new AuthError('Atualize seu navegador para manter a sessão com segurança.')
      return await navigator.locks.request(`cep-web-session:${this.baseUrl}`, action)
    }
    return action()
  }

  private interrupted(value?: boolean): boolean {
    // This is only a non-secret failure marker, never a token or identity.
    try {
      if (value === true) localStorage.setItem('cep-session-interrupted', '1')
      if (value === false) localStorage.removeItem('cep-session-interrupted')
      return localStorage.getItem('cep-session-interrupted') === '1'
    } catch {
      return false
    }
  }

  private async send(
    method: string,
    path: string,
    body?: object,
    token?: string | null,
  ): Promise<Response> {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, application/problem+json',
          ...(path.startsWith('/auth/web/') ? { 'X-CEP-Web-Session': '1' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: path.startsWith('/auth/web/') ? 'same-origin' : 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(
          path.startsWith('/organization/time-control/synchronizations') && method === 'POST'
            ? 180_000
            : 20_000,
        ),
      })
    } catch {
      throw new AuthError(
        'Não foi possível conectar. Verifique sua conexão. Se você estava salvando, confira o resultado antes de repetir.',
        undefined,
        'connection_failed',
      )
    }
    if (!response.ok) {
      throw apiFailure(response.status, await response.json().catch(() => null))
    }
    return response
  }

  private post(path: string, body: object) {
    return this.send('POST', path, body)
  }

  onExpired(listener: (error?: AuthError) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  restore(): Promise<AuthSession | null> {
    this.restoreFlight ??= (async () => {
      try {
        await this.refresh(true)
        const user = await this.request<User>('GET', '/me')
        return { user, expiresAt: new Date(this.expiresAt).toISOString() }
      } catch (error) {
        if (error instanceof AuthError && error.status === 401) return null
        throw error
      }
    })().finally(() => {
      this.restoreFlight = null
    })
    return this.restoreFlight
  }

  private expire(error?: AuthError) {
    this.epoch++
    this.accessToken = null
    this.hasSession = false
    this.user = null
    this.expiresAt = 0
    this.listeners.forEach((listener) => listener(error))
  }

  private accept(tokens: TokenResponse | null): AuthSession {
    if (
      !tokens?.accessToken ||
      !tokens.sessionExpiresAt ||
      !Number.isFinite(Date.parse(tokens.sessionExpiresAt)) ||
      Date.parse(tokens.sessionExpiresAt) <= Date.now() ||
      !tokens.user?.id ||
      !tokens.accessTokenExpiresAt ||
      !Number.isFinite(Date.parse(tokens.accessTokenExpiresAt)) ||
      Date.parse(tokens.accessTokenExpiresAt) <= Date.now()
    )
      throw new AuthError(
        'O serviço retornou uma resposta inesperada. Entre novamente.',
        undefined,
        'invalid_session_response',
      )
    this.accessToken = tokens.accessToken
    this.hasSession = true
    this.user = tokens.user
    this.expiresAt = Math.min(
      Date.parse(tokens.accessTokenExpiresAt),
      Date.parse(tokens.sessionExpiresAt),
    )
    return { user: tokens.user, expiresAt: new Date(this.expiresAt).toISOString() }
  }

  private refresh(restoring = false): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight
    const epoch = this.epoch
    this.refreshFlight = Promise.resolve()
      .then(() =>
        this.withSessionLock(async () => {
          let started = false
          try {
            if ((!restoring && !this.hasSession) || this.interrupted() || epoch !== this.epoch)
              throw new AuthError(
                'Sua sessão expirou. Entre novamente.',
                undefined,
                'session_expired',
                401,
              )
            // If the tab closes mid-rotation, the next tab must not replay an uncertain cookie.
            started = true
            this.interrupted(true)
            const response = await this.post('/auth/web/refresh', {})
            const tokens: TokenResponse | null = await response.json().catch(() => null)
            if (epoch !== this.epoch || (this.user && tokens?.user?.id !== this.user.id))
              throw new AuthError('A sessão foi encerrada.', undefined, 'session_expired', 401)
            this.accept(tokens)
            this.interrupted(false)
          } catch (error) {
            if (
              error instanceof AuthError &&
              (['connection_failed', 'invalid_session_response'].includes(error.code || '') ||
                (error.status !== undefined && error.status >= 500))
            ) {
              this.interrupted(true)
              this.channel?.postMessage('expired')
            } else if (
              started &&
              error instanceof AuthError &&
              error.status !== undefined &&
              error.status < 500
            ) {
              this.interrupted(false)
            }
            if (epoch === this.epoch && !restoring) this.expire(errorMessage(error))
            throw error
          }
        }),
      )
      .finally(() => {
        this.refreshFlight = null
      })
    return this.refreshFlight
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: object,
  ): Promise<T> {
    if (
      !path.startsWith('/organization/') &&
      !/^\/time-control\/(settings|notification-schedules(?:\/[0-9a-f-]{36})?)(\?|$)/i.test(path) &&
      !/^\/me\/notifications(?:\/received|\/[0-9a-f-]{36}\/read)?(\?|$)/i.test(path) &&
      !(method === 'POST' && path === '/me/time-control/power-action-check') &&
      !(method === 'POST' && path === '/me/time-control/power-action-unlock') &&
      !(method === 'GET' && /^\/me\/time-control\/power-action-status(\?|$)/.test(path)) &&
      path.split('?')[0] !== '/admin/organizations' &&
      path !== '/me'
    )
      throw new Error('Unsupported API route')
    if (this.refreshFlight) await this.refreshFlight
    if (!this.accessToken || this.expiresAt <= Date.now() + 30_000) await this.refresh()
    const token = this.accessToken
    const epoch = this.epoch
    let response: Response
    try {
      response = await this.send(method, path, body, token)
    } catch (error) {
      if (!(error instanceof AuthError) || error.status !== 401 || epoch !== this.epoch) throw error
      if (token === this.accessToken) await this.refresh()
      else if (this.refreshFlight) await this.refreshFlight
      try {
        response = await this.send(method, path, body, this.accessToken)
      } catch (retryError) {
        if (retryError instanceof AuthError && retryError.status === 401 && epoch === this.epoch)
          this.expire(retryError)
        throw retryError
      }
    }
    if (epoch !== this.epoch)
      throw new AuthError('Sua sessão foi encerrada.', undefined, 'session_expired', 401)
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
  }

  async login(credentials: Credentials): Promise<AuthSession> {
    const body: components['schemas']['LoginRequest'] = {
      email: credentials.email.trim(),
      password: credentials.password,
      client: { type: 'cep-horas-web', version: '0.2.0' },
    }
    try {
      const session = await this.withSessionLock(async () => {
        const response = await this.post('/auth/web/login', body)
        const tokens: TokenResponse | null = await response.json().catch(() => null)
        this.epoch++
        const session = this.accept(tokens)
        this.interrupted(false)
        this.channel?.postMessage('login')
        return session
      })
      session.user = await this.request<User>('GET', '/me')
      return session
    } catch (error) {
      this.expire()
      throw error
    }
  }

  async logout(): Promise<void> {
    if (this.refreshFlight) await this.refreshFlight.catch(() => undefined)
    if (!this.hasSession) return
    await this.withSessionLock(async () => {
      await this.post('/auth/web/logout', {})
      this.expire()
      this.channel?.postMessage('logout')
    })
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.post('/auth/password/forgot', { email: email.trim() })
  }

  async resetPassword(input: ResetPassword): Promise<void> {
    await this.post('/auth/password/reset', {
      ...input,
      email: input.email.trim(),
      code: input.code.trim(),
    })
  }

  async activateInvitation(input: ActivateInvitation): Promise<void> {
    await this.post('/auth/invitations/activate', {
      ...input,
      email: input.email.trim(),
      code: input.code.trim(),
      displayName: input.displayName.trim(),
    })
  }
}
