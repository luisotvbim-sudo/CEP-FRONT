# Telemetria estruturada do CEP Horas Windows

Implementação da [Issue CEP-ORQUESTRADOR #48](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/48), dependente da [API #47](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/47) e coordenada pela [Issue #45](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/45). Esta branch parte da tag `installer-v0.4.19` para preservar o código nativo usado no piloto. O próximo pacote manual planejado para esta implementação é o 0.4.20; seu build, publicação e instalação são etapas distintas.

## Contrato e fluxo

O host WPF envia `POST /api/v1/desktop-telemetry/events` com o bearer de sua sessão protegida. O WebView2 não possui rota na allowlist para esse POST; o serviço LocalSystem não recebe bearer. O lote tem 1–50 eventos e limite de 32 KiB. Cada evento contém somente `eventId`, `installationId`, `occurredAt`, `code`, `action`, `phase`, `outcome`, `errorCode`, `appVersion` e `operationId` (UUID da ação de energia, quando existe). O servidor deriva usuário e organização da sessão, grava `receivedAt` e confirma IDs aceitos ou rejeitados. Retentativas preservam `eventId`; o servidor deduplica no escopo autenticado.

O serviço gera um `installationId` aleatório uma vez em seu diretório protegido em ProgramData e o fornece ao host pelo IPC autenticado de `status`. Não deriva de hostname, SID, número de série ou hardware. O host só ativa a coleta no MSI gerenciado quando obtém esse ID e uma sessão autenticada. A fila é separada por usuário e protegida com DPAPI `CurrentUser`; contém até 500 eventos. O host tenta enviar ao gravar, após login/retomada e a cada minuto. Eventos com mais de 29 dias são descartados antes de bloquear os mais novos (a API aceita até 30 dias). Um lote com HTTP 400 é reduzido a um evento para isolar o registro inválido; um único evento recusado é removido com diagnóstico local genérico. IDs rejeitados explicitamente pela API também saem da fila. Falhas de rede, sessão, 429 e 5xx mantêm a fila para retentativa. Um 403 suspende as tentativas da conta no processo atual; contas `SystemAdmin` sem organização no token não participam desta coleta. A fila local existente é preservada, sem alegar que foi recebida pelo servidor.

O novo MSI instrumentado usa telemetria mínima estruturada por padrão. A TI pode definir `CEP_DESKTOP_TELEMETRY=0` no ambiente do processo para desligar coleta e envio. A variável não muda política nem autorização de energia. Ela não modifica o MSI 0.4.19 já distribuído. O servidor e a migration devem estar implantados antes da homologação do novo MSI; em API antiga, 404 conserva a fila local sem bloquear a aplicação.

## O que os eventos comprovam

| Código | Evidência |
|---|---|
| `desktop_started` | Host iniciou e obteve sessão autenticada. Falhas antes do login não têm identidade e não são enviadas. |
| `power_check_allowed`, `power_check_denied`, `power_check_failed` | Revalidação nativa da resposta da API, com decisão e erro categorizados. |
| `power_schedule_confirmed` | Host recebeu confirmação do serviço para o agendamento. **Não comprova que o Windows desligou, reiniciou ou hibernou.** |
| `power_schedule_failed` | Agendamento falhou ou ficou incerto após despacho; `outcome=uncertain` preserva resposta perdida. |
| `power_cancel_confirmed`, `power_cancel_failed` | Confirmação ou incerteza do cancelamento no IPC, sem reinterpretar o estado da ação. |
| `power_recovery_required`, `power_reconciled` | Estado pendente/incerto e reconciliação local; `not_pending` é incerto quanto à execução efetiva. |
| `update_check_failed`, `update_install_started`, `update_install_failed` | Observações do host na atualização MSI. |

O audit/journal do serviço SYSTEM permanece **local**; esta implementação não o envia à API e não observa o desligamento após a próxima inicialização. A apuração de uma ação real exige confrontar a trilha local do serviço e os eventos do Windows com o mesmo `operationId` quando disponível. Uma etapa futura pode criar um handoff local estruturado e leitura após reinício, com limites de acesso e sem transmitir SID. Não inferir execução real a partir de `power_schedule_confirmed`, nem tratar cancelamento incerto como cancelamento bem-sucedido.

## Privacidade, limites e ordem de implantação

Não enviar nome do PC, e-mail, SID, PIN, senha, token, corpo HTTP, stack trace ou mensagem de exceção. Códigos, fases, resultados, ação e erro são enums fechados. O host nunca envia fila de um usuário sob a sessão de outro. A API aplica isolamento por organização, limite de lote, retenção e deduplicação; o acesso administrativo precisa seguir seu contrato próprio.

A telemetria é secundária à segurança: falha de disco/rede/servidor não autoriza energia, não converte falha HTTP em contingência de transporte e não interrompe cancelamento ou recuperação. Para as confirmações de agendamento e cancelamento, o host aguarda até um segundo pela gravação durável local após o ACK do serviço. Se esse limite ou o disco falhar, o resultado de energia continua correto; esse evento pode faltar. Os demais eventos são enfileirados em segundo plano. Há risco residual de perda se o processo terminar antes da gravação; o serviço local mantém sua própria auditoria independente.

Homologar nesta ordem: (1) API/migration compatíveis e retenção; (2) contrato OpenAPI e tipos; (3) build/teste Windows sem ação real; (4) MSI novo em máquina piloto, offline/reinício/login/retentativa; (5) cruzar eventos por `installationId` e `operationId` sem identificação pessoal. Publicação e rollout dependem de aceite separado. O Docker pode testar ingestão e banco, mas não confirma serviço, DPAPI, WebView2, IPC, Windows Update ou energia física.
