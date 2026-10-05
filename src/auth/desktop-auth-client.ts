import {
  AuthError,
  type AuthClient,
  type AuthSession,
  type Credentials,
  type ResetPassword,
  type ActivateInvitation,
} from './auth-client'
import { apiFailure } from './errors'
import { BridgeCallFailure, callBridge, type WebViewBridge } from './bridge-transport'
export type { WebViewBridge } from './bridge-transport'

declare global {
  interface Window {
    __CEP_DESKTOP__?: boolean
    chrome?: { webview?: WebViewBridge }
  }
}

function nativeSession(value: unknown): AuthSession {
  const object = (item: unknown): item is Record<string, unknown> =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
  const uuid = (item: unknown) =>
    typeof item === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)
  if (
    !object(value) ||
    !object(value.user) ||
    !uuid(value.user.id) ||
    !['systemAdmin', 'organizationAdmin', 'user'].includes(String(value.user.role)) ||
    (value.user.organizationId != null && !uuid(value.user.organizationId)) ||
    (value.user.email != null && typeof value.user.email !== 'string') ||
    (value.user.displayName != null && typeof value.user.displayName !== 'string') ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= Date.now() ||
    'accessToken' in value ||
    'refreshToken' in value
  )
    throw new AuthError(
      'O aplicativo retornou uma sessão inválida. Entre novamente.',
      undefined,
      'invalid_session_response',
    )
  return { user: value.user, expiresAt: value.expiresAt } as AuthSession
}

export class DesktopAuthClient implements AuthClient {
  private listeners = new Set<(error?: AuthError) => void>()
  private restoring: Promise<AuthSession | null> | null = null
  constructor(private readonly bridge: WebViewBridge) {}

  private async call<T>(operation: string, payload: object = {}, timeout = 65_000): Promise<T> {
    try {
      return await callBridge<T>(this.bridge, 'cep-auth', operation, payload, timeout)
    } catch (error) {
      if (error instanceof BridgeCallFailure) {
        if (error.kind === 'reply') {
          const failure = error.failure
          const parsed = apiFailure(failure.status || 0, failure)
          const nativeError = new AuthError(
            parsed.message,
            parsed.correlationId,
            parsed.code,
            parsed.status,
            failure.transportFailure === true,
            failure.retryAfterSeconds,
          )
          if (failure.code === 'session_expired')
            this.listeners.forEach((listener) => listener(nativeError))
          throw nativeError
        }
        if (error.kind === 'timeout')
          throw new AuthError('O aplicativo demorou para responder. Tente novamente.')
        if (error.kind === 'invalid')
          throw new AuthError(
            'O aplicativo retornou uma resposta inválida.',
            undefined,
            'invalid_native_response',
          )
        throw new AuthError('Não foi possível comunicar com o aplicativo. Feche e abra novamente.')
      }
      throw error
    }
  }

  login(credentials: Credentials) {
    return this.call<unknown>(
      'login',
      {
        email: credentials.email.trim(),
        password: credentials.password,
      },
      60_000,
    ).then(nativeSession)
  }
  logout() {
    return this.call<void>('logout')
  }
  requestPasswordReset(email: string) {
    return this.call<void>('forgot', { email: email.trim() })
  }
  resetPassword(input: ResetPassword) {
    return this.call<void>('reset', {
      ...input,
      email: input.email.trim(),
      code: input.code.trim(),
    })
  }
  restore() {
    return (this.restoring ??= this.call<unknown>('restore', {}, 60_000)
      .then((value) => (value === null ? null : nativeSession(value)))
      .finally(() => {
        this.restoring = null
      }))
  }
  activateInvitation(input: ActivateInvitation) {
    return this.call<void>('activate-invitation', {
      ...input,
      email: input.email.trim(),
      code: input.code.trim(),
      displayName: input.displayName.trim(),
    })
  }
  onExpired(listener: (error?: AuthError) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object) {
    return this.call<T>(
      'api',
      { method, path, body },
      method === 'POST' && path.startsWith('/organization/time-control/synchronizations')
        ? 385_000
        : method === 'GET' && path.startsWith('/me/time-control/overview')
          ? 110_000
          : 65_000,
    )
  }
}
