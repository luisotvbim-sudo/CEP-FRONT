import { AuthError } from '../auth/auth-client'
import type { WebViewBridge } from '../auth/desktop-auth-client'
import type { PowerAction, PowerCheck } from './api'

declare global {
  interface Window {
    __CEP_POWER_VERSION__?: number
  }
}
export type PowerAuthorization = { kind: 'api'; check: PowerCheck } | { kind: 'api-unreachable' }
export type ScheduledPower = { requestId: string; action: PowerAction; executeAt: string }
export interface NativePower {
  verifyApiUnreachable(): Promise<boolean>
  schedule(action: PowerAction, authorization: PowerAuthorization): Promise<ScheduledPower>
  cancel(requestId: string): Promise<void>
}
export class NativePowerUncertain extends AuthError {
  constructor(public readonly requestId: string) {
    super(
      'O agendamento ou cancelamento não foi confirmado. Tente cancelar novamente e confira o estado no Windows.',
      undefined,
      'native_power_uncertain',
    )
  }
}

// A transport failure is only a candidate. The native host must independently
// confirm API unreachability; HTTP errors and invalid data never enter fallback.
export function mayVerifyOffline(error: unknown) {
  return (
    error instanceof AuthError &&
    error.code === 'connection_failed' &&
    (error.status === undefined ||
      error.status === 0 ||
      (error.status === 503 && error.transportFailure))
  )
}

export class NativePowerBridge implements NativePower {
  constructor(private readonly bridge: WebViewBridge) {}
  private call(operation: string, payload: object = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const clean = () => {
        clearTimeout(timer)
        this.bridge.removeEventListener('message', listener)
      }
      const listener: Parameters<WebViewBridge['addEventListener']>[1] = (event) => {
        if (event.data?.id !== id) return
        clean()
        if (event.data.ok) resolve(event.data.result)
        else
          reject(
            new AuthError(
              'O aplicativo não confirmou a operação de energia.',
              event.data.error?.correlationId,
              'native_power_failed',
            ),
          )
      }
      const timer = setTimeout(() => {
        clean()
        reject(
          new AuthError(
            'O aplicativo não confirmou a operação. Verifique o estado no Windows.',
            undefined,
            'native_power_timeout',
          ),
        )
      }, 5_000)
      this.bridge.addEventListener('message', listener)
      try {
        this.bridge.postMessage({ id, type: 'cep-power', operation, payload })
      } catch {
        clean()
        reject(new AuthError('Não foi possível comunicar com o menu de energia do aplicativo.'))
      }
    })
  }
  async verifyApiUnreachable() {
    const result = await this.call('verify-api-unreachable')
    return (
      result !== null &&
      typeof result === 'object' &&
      'unreachable' in result &&
      result.unreachable === true
    )
  }
  async schedule(action: PowerAction, authorization: PowerAuthorization) {
    const started = Date.now()
    // The request ID is known even if the reply is lost, so abort can be retried.
    const requestId = crypto.randomUUID()
    try {
      const result = (await this.call('schedule', {
        requestId,
        action,
        delaySeconds: 10,
        authorization,
      })) as ScheduledPower
      const deadline = Date.parse(result?.executeAt)
      if (
        !result ||
        result.requestId !== requestId ||
        result.action !== action ||
        !Number.isFinite(deadline) ||
        deadline < started + 10_000 ||
        deadline <= Date.now()
      )
        throw new AuthError('O aplicativo retornou um agendamento inválido.')
      return result
    } catch (error) {
      // Uncertain scheduling must never be repeated silently.
      try {
        await this.cancel(requestId)
      } catch {
        throw new NativePowerUncertain(requestId)
      }
      throw error
    }
  }
  async cancel(requestId: string) {
    const result = await this.call('cancel', { requestId })
    if (
      !result ||
      typeof result !== 'object' ||
      !('cancelled' in result) ||
      result.cancelled !== true
    )
      throw new AuthError('O cancelamento não foi confirmado. Tente cancelar novamente.')
  }
}

export function nativePower(): NativePower | null {
  return window.__CEP_DESKTOP__ && window.__CEP_POWER_VERSION__ === 1 && window.chrome?.webview
    ? new NativePowerBridge(window.chrome.webview)
    : null
}
