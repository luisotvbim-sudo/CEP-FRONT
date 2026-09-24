import type { components } from './api-schema'

export type User = components['schemas']['UserResponse']
type TokenResponse = components['schemas']['WebSessionResponse']
export type Credentials = { email: string; password: string }
export type ResetPassword = { email: string; code: string; newPassword: string }
export type AuthSession = { user: User; expiresAt: string }

// The UI consumes this interface in the browser and in WebView2.
// A native host can provide an adapter without exposing tokens to React.
export interface AuthClient {
  login(credentials: Credentials): Promise<AuthSession>
  logout(): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  resetPassword(input: ResetPassword): Promise<void>
  restore(): Promise<AuthSession | null>
  request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: object): Promise<T>
  onExpired(listener: (error?: AuthError) => void): () => void
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly correlationId?: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

type ApiProblem = { code?: string; correlationId?: string }

export function errorMessage(error: unknown): AuthError {
  return error instanceof AuthError
    ? error
    : new AuthError('Não foi possível concluir. Tente novamente em instantes.')
}

export function describeError(status: number, problem: ApiProblem): string {
  const messages: Record<string, string> = {
    external_identity_already_mapped:
      'Um dos perfis já está associado. Atualize a lista e confira a pessoa antes de tentar novamente.',
    external_identity_inactive:
      'Um dos perfis está inativo. Atualize os perfis e escolha identidades ativas.',
    external_identity_not_found: 'Um dos perfis não está disponível nesta organização.',
    external_identities_required: 'Selecione um perfil Monday e um perfil VR Mais.',
    email_unavailable:
      'Este e-mail já possui uma conta ou convite pendente. Confira a lista de pessoas.',
    invitation_not_found: 'Este convite não está disponível nesta organização. Atualize a lista.',
    invitation_not_pending: 'Este convite já foi aceito ou revogado e não pode ser reenviado.',
    last_organization_admin: 'Este é o último coordenador ativo da organização. Promova outro coordenador antes de alterar seu acesso.',
    user_not_found: 'Esta conta não está mais disponível na organização. Atualize a lista.',
    invalid_display_name: 'Informe um nome válido para o usuário.',
    email_domain_not_allowed: 'O domínio deste e-mail não está autorizado para cadastro.',
    sync_already_running: 'Já existe uma sincronização em andamento. Aguarde e consulte novamente; você só pode acompanhar lotes que solicitou.',
    sync_scope_empty: 'Não há pessoas no seu escopo com identidades ativas nas duas fontes. Peça ao coordenador para conferir vínculos e associações.',
    full_sync_forbidden: 'A carga completa é restrita à coordenação. Use a atualização dos últimos 7 dias.',
    monday_responsible_column_unavailable: 'A coluna de responsável do Monday não está disponível. Peça ao coordenador para revisar a configuração da fonte.',
    monday_multiple_responsibles: 'Há item do Monday com mais de um responsável. Corrija a atribuição na origem e atualize novamente.',
    sync_not_found: 'Nenhuma sincronização foi iniciada.',
    team_name_unavailable: 'Já existe um time com esse nome.',
    team_assignment_overlap:
      'Já existe um vínculo para essa pessoa e função em um período sobreposto.',
    team_assignment_already_ended: 'Este vínculo já possui data de encerramento. Atualize a lista.',
    invalid_assignment_period:
      'Confira as datas de vigência. O fim não pode ser anterior ao início.',
    team_inactive: 'Ative o time antes de adicionar vínculos.',
    user_inactive: 'Esta conta está inativa e não pode receber um vínculo.',
    history_period_too_large: 'Selecione um intervalo de até 90 dias, incluindo as duas datas.',
    invalid_history_period: 'Informe um período válido para a consulta.',
    session_expired: 'Sua sessão expirou ou foi revogada. Entre novamente.',
    web_origin_invalid:
      'Não foi possível validar a origem da sessão. Confira a configuração do endereço e do proxy com o responsável.',
    desktop_request_failed:
      'Não foi possível conectar. Verifique sua conexão. Se você estava salvando, confira o resultado antes de repetir.',
  }
  if (problem.code && messages[problem.code]) return messages[problem.code]
  if (problem.code === 'invalid_reset_code')
    return 'O código é inválido ou expirou. Solicite um novo código e tente novamente.'
  if (status === 429)
    return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
  if (status === 401 || problem.code === 'invalid_credentials')
    return 'E-mail ou senha inválidos, ou acesso indisponível. Confira seus dados e tente novamente.'
  if (status === 403)
    return 'Sua conta não tem acesso no momento. Entre em contato com o coordenador.'
  if (status === 400) return 'Confira os dados informados e tente novamente.'
  return 'Não foi possível acessar o serviço. Tente novamente em instantes.'
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
      const problem: ApiProblem = await response.json().catch(() => ({}))
      throw new AuthError(
        describeError(response.status, problem ?? {}),
        typeof problem?.correlationId === 'string' ? problem.correlationId : undefined,
        problem?.code,
        response.status,
      )
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
    })()
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

  async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: object): Promise<T> {
    if (
      !path.startsWith('/organization/') &&
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
}
