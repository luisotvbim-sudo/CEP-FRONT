export class AuthError extends Error {
  constructor(
    message: string,
    public readonly correlationId?: string,
    public readonly code?: string,
    public readonly status?: number,
    public readonly transportFailure = false,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export type ApiProblem = { code?: string; correlationId?: string }

export function apiFailure(status: number, value: unknown): AuthError {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const problem: ApiProblem = {
    code: typeof raw.code === 'string' ? raw.code : undefined,
    correlationId: typeof raw.correlationId === 'string' ? raw.correlationId : undefined,
  }
  return new AuthError(describeError(status, problem), problem.correlationId, problem.code, status)
}

export function errorMessage(error: unknown): AuthError {
  return error instanceof AuthError
    ? error
    : new AuthError('Não foi possível concluir. Tente novamente em instantes.')
}

const messages: Record<string, string> = {
  invalid_admin_pin: 'PIN administrativo inválido. Confira os 6 dígitos e tente novamente.',
  power_unlock_rate_limited: 'Limite de liberações atingido. Aguarde antes de tentar novamente.',
  power_pin_not_configured:
    'O PIN administrativo ainda não foi configurado. Procure o responsável.',
  invalid_invitation:
    'Convite inválido, expirado ou já utilizado. Confira o código mais recente ou solicite um novo ao administrador.',
  invalid_password: 'A senha não atende aos requisitos. Use entre 12 e 200 caracteres.',
  email_already_exists:
    'Este e-mail já possui uma conta. Volte para entrar ou recuperar sua senha.',
  organization_inactive: 'A organização está indisponível. Procure o administrador.',
  configuration_conflict:
    'Outro administrador alterou esta configuração. Recarregue a versão atual antes de salvar novamente.',
  schedule_time_conflict:
    'Já existe um agendamento nesse horário. Edite o agendamento existente ou escolha outro horário.',
  schedule_not_found: 'Este agendamento foi excluído. Atualize a lista.',
  invalid_schedule: 'Informe um horário com precisão de minutos e uma mensagem válida.',
  notification_scope_empty:
    'Não há contas ativas associadas às fontes nesse escopo. Confira as pessoas e os vínculos.',
  notification_cooldown:
    'Aguarde um minuto antes de solicitar outro envio. O envio anterior continua no histórico.',
  notification_request_conflict:
    'Este identificador de envio já foi usado para outro conteúdo. Confira o histórico e prepare uma nova mensagem.',
  notification_not_found: 'A notificação não está disponível para sua conta. Atualize a central.',
  invalid_analysis_period: 'Selecione um período de análise disponível.',
  invalid_analysis_issue: 'Selecione um tipo de ocorrência disponível.',
  invalid_notification_request: 'Confira destinatário, período e mensagem antes de enviar.',
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
  last_organization_admin:
    'Este é o último coordenador ativo da organização. Promova outro coordenador antes de alterar seu acesso.',
  user_not_found: 'Esta conta não está mais disponível na organização. Atualize a lista.',
  invalid_display_name: 'Informe um nome válido para o usuário.',
  email_domain_not_allowed: 'O domínio deste e-mail não está autorizado para cadastro.',
  sync_already_running:
    'Já existe uma sincronização em andamento. Aguarde e consulte novamente; você só pode acompanhar lotes que solicitou.',
  sync_scope_empty:
    'Não há pessoas no seu escopo com identidades ativas nas duas fontes. Peça ao coordenador para conferir vínculos e associações.',
  full_sync_forbidden:
    'A carga completa é restrita à coordenação. Use a atualização dos últimos 7 dias.',
  monday_responsible_column_unavailable:
    'A coluna de responsável do Monday não está disponível. Peça ao coordenador para revisar a configuração da fonte.',
  monday_multiple_responsibles:
    'Há item do Monday com mais de um responsável. Corrija a atribuição na origem e atualize novamente.',
  sync_not_found: 'Nenhuma sincronização foi iniciada.',
  team_name_unavailable: 'Já existe um time com esse nome.',
  team_assignment_overlap:
    'Já existe um vínculo para essa pessoa e função em um período sobreposto.',
  team_assignment_already_ended: 'Este vínculo já possui data de encerramento. Atualize a lista.',
  invalid_assignment_period: 'Confira as datas de vigência. O fim não pode ser anterior ao início.',
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
export function describeError(status: number, problem: ApiProblem): string {
  if (problem.code && Object.hasOwn(messages, problem.code)) return messages[problem.code]
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
