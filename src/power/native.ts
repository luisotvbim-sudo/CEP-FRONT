import { AuthError } from '../auth/auth-client'
import { BridgeCallFailure, callBridge, type WebViewBridge } from '../auth/bridge-transport'
import type { PowerAction, PowerCheck } from './api'

export const nativePowerMessages: Record<string, string> = {
  native_power_unavailable:
    'A execução de energia exige a instalação corporativa do CEP Horas. Solicite suporte à TI.',
  power_service_unavailable:
    'Não foi possível comunicar com o serviço Windows de energia. Confira o estado no Windows e solicite à TI a verificação do serviço.',
  power_service_timeout:
    'O serviço Windows de energia não respondeu dentro do prazo. Confira o estado no Windows antes de tentar novamente.',
  power_service_invalid_response:
    'O serviço Windows de energia retornou uma resposta inválida. Confira o estado no Windows e solicite suporte à TI.',
  native_power_timeout:
    'O serviço de energia não confirmou a operação dentro do prazo. Confira o estado no Windows.',
  invalid_native_response:
    'O aplicativo retornou uma resposta de energia inválida. Confira o estado no Windows e solicite suporte à TI.',
  invalid_power_response:
    'A API retornou uma resposta inválida. Nenhuma ação foi agendada; use Verificar status.',
  power_not_authorized:
    'A revalidação recusou a ação. A liberação pode ter expirado ou o acesso mudado. Verifique o status antes de tentar novamente.',
  update_maintenance:
    'Uma atualização está em andamento. Aguarde seu término antes de solicitar energia.',
  access_denied:
    'O serviço Windows recusou o acesso do aplicativo. Solicite à TI a verificação da instalação.',
  service_error:
    'O serviço Windows falhou ao processar a operação. Confira o estado no Windows e solicite suporte à TI.',
  inactive:
    'A proteção de energia do aplicativo não está ativa. Solicite à TI a verificação do serviço.',
  power_recovery_in_progress:
    'O aplicativo está em recuperação. Aguarde antes de solicitar uma ação.',
  power_request_cancelled: 'A solicitação foi interrompida pelo aplicativo.',
  power_authorization_timeout: 'A verificação demorou para responder. Verifique novamente.',
  session_expired: 'Sua sessão expirou. Entre novamente.',
  power_service_changed:
    'O serviço de energia precisa de atualização ou recuperação. Confira o estado no Windows.',
  power_uncertain: 'Há uma solicitação de energia pendente de revisão pelo titular ou pela TI.',
  power_storage_unavailable:
    'Não foi possível registrar o estado de energia. Solicite suporte à TI.',
}

declare global {
  interface Window {
    __CEP_POWER_VERSION__?: number
  }
}
export type PowerAuthorization = { kind: 'api'; check: PowerCheck } | { kind: 'api-unreachable' }
export type ScheduledPower = { requestId: string; action: PowerAction; executeAt: string }
export type PowerState = { requestId: string; state: 'pending' | 'terminal' }
export interface NativePower {
  verifyApiUnreachable(): Promise<boolean>
  schedule(action: PowerAction, authorization: PowerAuthorization): Promise<ScheduledPower>
  cancel(requestId: string): Promise<void>
  reconcile(requestId: string): Promise<PowerState>
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
  private async call(operation: string, payload: object = {}): Promise<unknown> {
    // Host: authorization <= 65s (including refresh/probe), IPC <= 9s.
    // Probe: <= 5s. Cancellation never waits for API revalidation.
    const timeout =
      operation === 'schedule' ? 80_000 : operation === 'verify-api-unreachable' ? 7_000 : 12_000
    try {
      return await callBridge(this.bridge, 'cep-power', operation, payload, timeout)
    } catch (error) {
      if (error instanceof BridgeCallFailure) {
        if (error.kind === 'reply') {
          if (
            (error.failure.code === 'native_power_uncertain' ||
              error.failure.code === 'power_recovery_required') &&
            error.failure.requestId
          )
            throw new NativePowerUncertain(error.failure.requestId)
          const messages = nativePowerMessages
          throw new AuthError(
            Object.hasOwn(messages, error.failure.code ?? '')
              ? messages[error.failure.code!]
              : 'O aplicativo não confirmou a operação de energia.',
            error.failure.correlationId ?? undefined,
            error.failure.code ?? 'native_power_failed',
          )
        }
        throw new AuthError(
          error.kind === 'unavailable'
            ? 'Não foi possível comunicar com o menu de energia do aplicativo.'
            : 'O aplicativo não confirmou a operação. Verifique o estado no Windows.',
          undefined,
          error.kind === 'timeout' ? 'native_power_timeout' : 'invalid_native_response',
        )
      }
      throw error
    }
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
      // A different ID identifies the host's existing action. It has not been
      // dispatched by this call and requires the user's explicit Cancel action.
      if (error instanceof NativePowerUncertain && error.requestId !== requestId) throw error
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
      throw new AuthError(
        'O cancelamento não foi confirmado. Tente cancelar novamente.',
        undefined,
        'native_power_uncertain',
      )
  }
  async reconcile(requestId: string): Promise<PowerState> {
    const result = await this.call('reconcile', { requestId })
    if (
      !result ||
      typeof result !== 'object' ||
      !('requestId' in result) ||
      result.requestId !== requestId ||
      !('state' in result) ||
      (result.state !== 'pending' && result.state !== 'terminal')
    )
      throw new NativePowerUncertain(requestId)
    return { requestId, state: result.state }
  }
}

export function nativePower(): NativePower | null {
  return window.__CEP_DESKTOP__ && window.__CEP_POWER_VERSION__ === 1 && window.chrome?.webview
    ? new NativePowerBridge(window.chrome.webview)
    : null
}
