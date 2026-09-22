import {
  AuthError,
  describeError,
  type AuthClient,
  type AuthSession,
  type Credentials,
  type ResetPassword,
} from './auth-client'

type BridgeEvent = {
  data: {
    id?: string
    ok?: boolean
    result?: unknown
    error?: { status?: number; code?: string; correlationId?: string }
  }
}
export type WebViewBridge = {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: BridgeEvent) => void): void
  removeEventListener(type: 'message', listener: (event: BridgeEvent) => void): void
}

declare global {
  interface Window {
    __CEP_DESKTOP__?: boolean
    chrome?: { webview?: WebViewBridge }
  }
}

export class DesktopAuthClient implements AuthClient {
  private listeners = new Set<(error?: AuthError) => void>()
  private restoring: Promise<AuthSession | null> | null = null
  constructor(private readonly bridge: WebViewBridge) {}

  private call<T>(operation: string, payload: object = {}, timeout = 25_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID()
      const cleanup = () => {
        clearTimeout(timer)
        this.bridge.removeEventListener('message', listener)
      }
      const listener = (event: BridgeEvent) => {
        if (event.data?.id !== id) return
        cleanup()
        if (event.data.ok) resolve(event.data.result as T)
        else {
          const failure = event.data.error ?? {}
          const error = new AuthError(
            describeError(failure.status || 0, failure),
            failure.correlationId,
            failure.code,
            failure.status,
          )
          if (failure.code === 'session_expired')
            this.listeners.forEach((listener) => listener(error))
          reject(error)
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new AuthError('O aplicativo demorou para responder. Tente novamente.'))
      }, timeout)
      this.bridge.addEventListener('message', listener)
      try {
        this.bridge.postMessage({ id, type: 'cep-auth', operation, payload })
      } catch {
        cleanup()
        reject(
          new AuthError('Não foi possível comunicar com o aplicativo. Feche e abra novamente.'),
        )
      }
    })
  }

  login(credentials: Credentials) {
    return this.call<AuthSession>(
      'login',
      {
        email: credentials.email.trim(),
        password: credentials.password,
      },
      45_000,
    )
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
    return (this.restoring ??= this.call<AuthSession | null>('restore', {}, 45_000))
  }
  onExpired(listener: (error?: AuthError) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: object) {
    return this.call<T>(
      'api',
      { method, path, body },
      method === 'POST' && path.startsWith('/organization/time-control/synchronizations')
        ? 385_000
        : 65_000,
    )
  }
}
