import { errorMessage } from '../auth/auth-client'
import { nativePowerMessages } from './native'

// Never echo exception text, request bodies, or the PIN. Only known public
// messages and a bounded support identifier are displayed by the energy menu.
export function powerFailure(error: unknown, operation: 'unlock' | 'action' | 'cancel') {
  const failure = errorMessage(error)
  let message =
    operation === 'unlock'
      ? 'Não foi possível confirmar a liberação. Use Verificar status antes de repetir o PIN; nenhuma ação foi agendada.'
      : Object.hasOwn(nativePowerMessages, failure.code ?? '')
        ? nativePowerMessages[failure.code!]
        : 'A operação de energia não foi confirmada. Confira o estado no Windows antes de tentar novamente.'
  if (failure.code === 'native_power_uncertain')
    message =
      'O agendamento ou cancelamento não foi confirmado. Tente cancelar novamente e confira o estado no Windows.'
  if (failure.status === 401 || failure.code === 'session_expired')
    message =
      'Sua sessão expirou ou foi revogada. Entre novamente antes de liberar ou executar uma ação.'
  else if (operation === 'unlock') {
    if (failure.code === 'invalid_admin_pin')
      message =
        'PIN administrativo recusado. Confira os 6 dígitos com a TI. Esta tentativa não renovou a liberação.'
    else if (failure.status === 403)
      message =
        'Sua conta não está autorizada a obter esta liberação. Procure o coordenador; isso não indica PIN incorreto.'
    else if (failure.status === 429 || failure.code === 'power_unlock_rate_limited')
      message =
        failure.retryAfterSeconds &&
        Number.isFinite(failure.retryAfterSeconds) &&
        failure.retryAfterSeconds > 0
          ? `Limite de tentativas atingido. Aguarde pelo menos ${failure.retryAfterSeconds} segundos antes de tentar novamente.`
          : 'Limite de tentativas atingido. Aguarde alguns minutos antes de tentar novamente.'
    else if (failure.code === 'power_pin_not_configured')
      message =
        'O PIN administrativo não está configurado no serviço. Solicite a configuração à TI.'
    else if (
      failure.code === 'invalid_power_response' ||
      failure.code === 'invalid_native_response' ||
      error instanceof SyntaxError
    )
      message =
        'A resposta da liberação não pôde ser validada. Use Verificar status antes de repetir o PIN; nenhuma ação foi agendada.'
    else if (
      failure.code === 'connection_failed' ||
      failure.code === 'desktop_request_failed' ||
      failure.code === 'desktop_timeout'
    )
      message =
        'A resposta da liberação não foi recebida. Confira a conexão e use Verificar status antes de repetir o PIN; nenhuma ação foi agendada.'
    else if (failure.status && failure.status >= 500)
      message =
        'O serviço está indisponível para validar o PIN. Aguarde e verifique o status; nenhuma ação foi agendada.'
  }
  const support =
    failure.correlationId && /^[a-zA-Z0-9_-]{1,100}$/.test(failure.correlationId)
      ? ` Código para suporte: ${failure.correlationId}`
      : ''
  return message + support
}
