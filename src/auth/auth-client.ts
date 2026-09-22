import type { components } from './api-schema'

export type User = components['schemas']['UserResponse']
type TokenResponse = components['schemas']['TokenResponse']
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
    email_domain_not_allowed: 'O domínio deste e-mail não está autorizado para cadastro.',
    sync_already_running: 'Já existe uma sincronização em andamento. Acompanhe o resultado abaixo.',
    sync_not_found: 'Nenhuma sincronização foi iniciada.',
    team_name_unavailable: 'Já existe uma equipe com esse nome.',
    team_assignment_overlap:
      'Já existe um vínculo para essa pessoa e função em um período sobreposto.',
    team_assignment_already_ended: 'Este vínculo já possui data de encerramento. Atualize a lista.',
    invalid_assignment_period:
      'Confira as datas de vigência. O fim não pode ser anterior ao início.',
    team_inactive: 'Ative a equipe antes de adicionar vínculos.',
    user_inactive: 'Esta conta está inativa e não pode receber um vínculo.',
    history_period_too_large: 'Selecione um intervalo de até 60 dias, incluindo as duas datas.',
    invalid_history_period: 'Informe um período válido para a consulta.',
    session_expired: 'Sua sessão expirou ou foi revogada. Entre novamente.',
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
    return 'Sua conta não tem acesso no momento. Entre em contato com o administrador.'
  if (status === 400) return 'Confira os dados informados e tente novamente.'
  return 'Não foi possível acessar o serviço. Tente novamente em instantes.'
}

export class HttpAuthClient implements AuthClient {
  private refreshToken: string | null = null
  private accessToken: string | null = null
  private expiresAt = 0
  private refreshFlight: Promise<void> | null = null
  private epoch = 0
  private listeners = new Set<(error?: AuthError) => void>()

  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = '/api/v1',
  ) {}

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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
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
  async restore(): Promise<AuthSession | null> {
    return null
  }

  private expire(error?: AuthError) {
    this.epoch++
    this.accessToken = null
    this.refreshToken = null
    this.expiresAt = 0
    this.listeners.forEach((listener) => listener(error))
  }

  private accept(tokens: TokenResponse | null): AuthSession {
    if (
      !tokens?.accessToken ||
      !tokens.refreshToken ||
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
    this.refreshToken = tokens.refreshToken
    this.expiresAt = Date.parse(tokens.accessTokenExpiresAt)
    return { user: tokens.user, expiresAt: tokens.accessTokenExpiresAt }
  }

  private refresh(): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight
    const token = this.refreshToken
    const epoch = this.epoch
    // A lost refresh response must never cause replay of the previous token.
    this.refreshToken = null
    this.refreshFlight = Promise.resolve().then(async () => {
      try {
        if (!token)
          throw new AuthError(
            'Sua sessão expirou. Entre novamente.',
            undefined,
            'session_expired',
            401,
          )
        const response = await this.post('/auth/refresh', { refreshToken: token })
        const tokens: TokenResponse | null = await response.json().catch(() => null)
        if (epoch !== this.epoch)
          throw new AuthError('A sessão foi encerrada.', undefined, 'session_expired', 401)
        this.accept(tokens)
      } catch (error) {
        if (epoch === this.epoch) this.expire(errorMessage(error))
        throw new AuthError(
          'Sua sessão expirou ou não pôde ser renovada. Entre novamente.',
          error instanceof AuthError ? error.correlationId : undefined,
          'session_expired',
          401,
        )
      } finally {
        this.refreshFlight = null
      }
    })
    return this.refreshFlight
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: object): Promise<T> {
    if (!path.startsWith('/organization/') && path !== '/me')
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
    const response = await this.post('/auth/login', body)
    const tokens: TokenResponse | null = await response.json().catch(() => null)
    this.epoch++
    try {
      const session = this.accept(tokens)
      session.user = await this.request<User>('GET', '/me')
      return session
    } catch (error) {
      this.expire()
      throw error
    }
  }

  async logout(): Promise<void> {
    if (this.refreshFlight) await this.refreshFlight.catch(() => undefined)
    const token = this.refreshToken
    if (!token) return
    await this.post('/auth/logout', { refreshToken: token })
    if (this.refreshToken === token) this.expire()
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
