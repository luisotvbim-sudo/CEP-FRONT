# Menu de energia: contrato e execução

Reconciliado em 04/10/2026. O contrato pessoal foi conferido na CEP API `main` `b36c6e149b42253b44860d98c6ffe44f98c53dd6`; interface e bridge estão presentes no CEP-FRONT `main` `eb63dbdc7f7bf83d0a4b51ee5567ed5aa80c138c`. As branches integrada e do atualizador preservam esse fluxo. A [matriz do instalador](CONTEXTO-INSTALADOR.md) separa funcionalidades por base.

## Interface e decisão

As áreas autenticadas têm um rodapé recolhível com **Desligar**, **Reiniciar**, **Hibernar** e **Verificar status**, inclusive páginas globais de SystemAdmin. Login, download público e prévia de desenvolvimento não mostram esse menu. Há foco visível, rótulos, teclado de `details/summary`, região de avisos e adaptação a janelas pequenas.

| Operação | Endpoint e parâmetros | Efeito |
|---|---|---|
| Verificar uma ação | `POST /api/v1/me/time-control/power-action-check`, corpo com `action` | Decisão para `shutdown`, `restart` ou `hibernate`. |
| Consultar estado | `GET /api/v1/me/time-control/power-action-status?action=shutdown` | Consulta informativa, sem execução. |
| Liberação administrativa pessoal | `POST /api/v1/me/time-control/power-action-unlock`, corpo com `pin` | Override temporário da conta autenticada. |

Não enviar `organizationId`, pessoa ou período nessas rotas. A conta e a organização são determinadas pelo servidor. Não ampliar autorização pelo papel apresentado no React ou pela seleção de organização do SystemAdmin.

O cliente valida o DTO e usa `decision`. `blocked`, `indeterminate`, corpo inválido e erros HTTP impedem o agendamento. `allowed` no navegador informa que a execução exige aplicativo Windows corporativo. O front não calcula horas/tolerância nem converte dados incompletos em permissão. Verificar status não substitui o POST no momento da ação.

## PIN de cinco minutos

O campo aceita exatamente seis dígitos ASCII, preserva zeros iniciais, usa entrada protegida/teclado numérico e desativa autocomplete. O PIN é dedicado à energia e distinto da senha de login. Não há seleção de outra conta nem provisionamento do PIN na interface.

O valor é transitório: o campo é limpo antes de qualquer tentativa, inclusive inválida, no logout e na desmontagem. Não persistir em estado React, URL, armazenamento web, sessão DPAPI, logs, capturas, MSI ou serviço Windows. Apenas a API recebe `{ pin }` pelo endpoint exato; a allowlist nativa admite POST sem query string nesse caminho.

A resposta deve conter `override: true`, `serverTime` e `unlockedUntil` com diferença exata de cinco minutos. A contagem utiliza o relógio do servidor e `performance.now()`, descontando conservadoramente o tempo da requisição. Alterar o relógio local não estende a liberação. A contagem é informativa: cada ação consulta a API e o WPF refaz a consulta.

Durante o override, a decisão tem `allowed`, `administrative_override`, `override: true`, prazo e `analysis: null`. Resposta normal tem `override: false` e `unlockedUntil: null`. Uma consulta de status sem o `serverTime` original mostra o prazo informado, sem inventar nova janela. Expiração remove a indicação local; logout não reinicia a janela que a API mantém. Tentativa inválida não estende a janela; rotação do PIN e mudanças de segurança/acesso invalidam o override no backend.

| HTTP/código | Tratamento |
|---|---|
| 403 `invalid_admin_pin` | Mostrar erro; limpar campo; não alterar prazo anterior. |
| 429 `power_unlock_rate_limited` | Informar limite de tentativas; limpar campo. |
| 503 `power_pin_not_configured` | Informar configuração ausente; limpar campo. |

Esses retornos nunca autorizam contingência. Migration e provisionamento seguro pertencem ao backend: [contrato do PIN](https://github.com/luisotvbim-sudo/CEP-API/blob/b36c6e149b42253b44860d98c6ffe44f98c53dd6/docs/power-admin-unlock.md). Não copiar valor, hash ou configuração secreta para este repositório.

## React, WPF e serviço

Somente a instalação corporativa anuncia `window.__CEP_POWER_VERSION__ = 1`, junto do bridge desktop. Navegador, Debug e pacote portátil não anunciam execução local. Sessão e tokens ficam no host nativo; a persistência usa DPAPI `CurrentUser` separada pela origem da API. React recebe resultados/metadados permitidos.

O WebView envia operações `cep-power` correlacionadas por `id`. A interface não envia comando do Windows nem executa a ação ao chegar a zero.

| Operação do bridge | Payload | Regra do host |
|---|---|---|
| `schedule` | `requestId` UUID, `action`, `delaySeconds: 10`, `authorization` | Validar origem/sessão e refazer a verificação autenticada; só então pedir ação fixa ao serviço. A decisão anexada pelo JavaScript não é credencial. |
| `cancel` | `requestId` UUID | Confirmar aborto ou ausência de agendamento correspondente; preservar tratamento de incerteza. |
| `verify-api-unreachable` | Vazio | Fazer verificação de transporte independente. Não confiar num indicador do renderer. |

O sucesso do agendamento devolve `requestId`, `action` e `executeAt` UTC. A contagem de dez segundos deriva desse horário e pode ser cancelada. Cancelamento falho/incerto mantém o identificador e permite repetir; novas ações permanecem bloqueadas enquanto a interface não confirmou o aborto. Timeout do protocolo não significa sucesso nem prova API offline. Em agendamento sem confirmação, o adaptador tenta cancelar pelo mesmo ID.

O host só aceita uma resposta normal válida com `within_tolerance`, `override: false`, prazo nulo e análise, ou override válido com `administrative_override`, `override: true`, prazo e análise nula. Não aceita permissão inventada pelo JavaScript. A API continua soberana sobre a regra e o período; o WPF verifica a estrutura necessária para executar.

O serviço autentica o cliente interativo e o caminho do executável instalado, verifica controle ativo/políticas, aceita apenas `shutdown`, `restart`, `hibernate` e dez segundos. Cancelamento pertence à mesma identidade Windows. Há idempotência e intenção de cancelamento no estado em memória do serviço; não prometer histórico durável de pedidos após reinício. Desligamento/reinício usam o agendamento do Windows; hibernação tem temporizador cancelável.

Ao sair da conta, interface/host solicitam cancelamento. Se o processo ou serviço falhar, não inferir execução ou aborto pelo estado visual: tratar como operação incerta e obter confirmação do serviço. PIN e token não atravessam o named pipe.

## Contingência de transporte

O candidato inicial só existe após falha de conexão sem resposta HTTP: `connection_failed` sem status/status 0, ou erro sintético nativo explicitamente marcado `transportFailure: true`. O marcador é produzido pelo host; não vem do corpo da API.

1. WPF consulta `/health/ready` com prazo curto.
2. Qualquer resposta HTTP, inclusive 400/401/403/429/500/503, significa API alcançável.
3. Somente falha de transporte nessa consulta permite contingência candidata.
4. Ao agendar, o host confirma novamente a indisponibilidade.
5. A ação mantém dez segundos e cancelamento pelo serviço.

Falha Monday/VR, banco indisponível com resposta HTTP, autenticação, PIN, corpo inválido, corpo interrompido depois dos headers, bridge ou serviço Windows não são API offline. Não criar bypass com base em mensagem de erro ou decisão `indeterminate`.

## Energia e manutenção do aplicativo

Fechar a janela normalmente envia o host para a bandeja. Desde a branch integrada 0.4.6, **Fechar CEP Horas** usa uma verificação diária local independente do PIN. O serviço restaura políticas antes de suspender relançamento para aquela sessão; abrir manualmente reaplica proteção. Essa restauração muda configurações da máquina, por isso múltiplas sessões precisam ser avaliadas no piloto. A main 0.4.3 não contém essa função.

A [correção 0.4.12](liberacao-energia-0.4.12.md) preserva os direitos de logon originais para permitir restaurar os controles sem abandonar a sessão a cada fechamento. A escolha foi explicitamente aprovada, incluindo o limite de permitir comandos externos de desligamento. Não muda a decisão/revalidação da API dentro do CEP. Sessões antigas sem permissão exigem uma renovação inicial; GPO original não é removida.

No [pacote 0.4.11](instalador-0.4.11.md), manutenção MSI cancela pedidos conhecidos desta instância, bloqueia novos agendamentos e preserva políticas. Pedido herdado após crash ou intenção sem confirmação exige cancelamento explícito do titular, com ID e broker original; manutenção/recarga/startup não o cancelam automaticamente. Não usa `desktop-suspend`. Recuperar/recarregar o WebView2 não agenda ação de energia nem encerra o serviço.

## Fontes e validação

Consultar [PowerBridgeHandler](../desktop/CepHoras.Desktop/PowerBridgeHandler.cs), [ApiSession](../desktop/CepHoras.Desktop/ApiSession.cs), [ApiRoutePolicy](../desktop/CepHoras.Desktop/ApiRoutePolicy.cs), [PowerAuthority](../desktop/CepHoras.Control/PowerAuthority.cs) e [protocolo do serviço](../desktop/CepHoras.Control.Protocol/Protocol.cs). O [contrato da API](https://github.com/luisotvbim-sudo/CEP-API/blob/b36c6e149b42253b44860d98c6ffe44f98c53dd6/docs/power-action-check.md) e os snapshots [atual](openapi-backend-current.json)/[cliente](openapi.json) descrevem os DTOs.

Para uma mudança funcional, verificar testes de cliente/allowlist/bridge, casos PIN e tempo de servidor, HTTP versus transporte, idempotência/cancelamento e executores falsos. Esses testes não executam as três ações reais. Homologação Windows é acompanhada na [Issue #7](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/7): conta comum, instalação/políticas, PIN/expiração, decisão normal, três ações, cancelamento e contingência real. Não testar desligamento numa máquina de trabalho sem preparar esse piloto.

Esta revisão conferiu documentação com o código; não executou novos builds, testes de energia, provisionamento ou implantação.
