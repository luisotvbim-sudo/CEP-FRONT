# Avisos de senha diária e PIN de energia

Entrega da [Issue central #34](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/34),
na branch `codex/password-feedback`, baseada na tag `installer-v0.4.16`,
commit `f197abbf1efab81a42a80967e0fd25e759d37054`.
Esta alteração não gera nova versão MSI nem declara publicação ou instalação.

## Correções de estado do serviço e recuperação

A [Issue central #35](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/35)
é implementada em `codex/windows-password-causes`, sobre a PR #28,
`d10a30a5359c28cc52746e7c92aab5201e274d9b`. Essa base de código contém o
feedback aprovado; não representa `main`, novo MSI distribuído ou produção.

**F01 — resposta após restauração:** o serviço usava o mesmo prazo de cinco
segundos para ler o pedido, executar a restauração e escrever a resposta.
Uma restauração de 5,2 segundos completava a suspensão, mas cancelava a escrita.
Agora leitura e escrita têm prazos próprios de cinco segundos, ligados à parada
do serviço; o efeito permanece síncrono, serializado e não é abandonado em uma
tarefa. O cliente reserva oito segundos para conectar, cinco para enviar e trinta
para receber somente `desktop-suspend`/`desktop-resume`. Os demais comandos
mantêm oito segundos totais. Esses prazos limitam o transporte e não garantem a
duração da operação de política.

O host fecha somente após `desktop_suspended` e conclusão do fechamento. Uma
recusa, resposta perdida ou erro após confirmação mantém o CEP aberto e solicita
`desktop-resume` uma vez, sem repetir suspensão. Somente `desktop_resumed`
confirma a reconciliação; falha exige aviso à TI. O serviço não reverte políticas
por falha de escrita, pois o cliente pode ter recebido a resposta e estar fechando.

**F02 — descoberta de pedido anterior:** a consulta nativa identifica pedidos
herdados/incertos e agendados ainda ativos mesmo após reinício apenas do host.
Abrir Energia ou usar Verificar status consulta o serviço antes da API; uma
recusa de nova autorização não impede descobrir/cancelar o pedido próprio.
O cancelamento de pedido recuperado é sempre explícito e não ocorre ao desmontar
o menu, por relógio, recarga, saída ou atualização. Pedidos criados pelo host atual
conservam a política anterior de cancelamento na desmontagem. Resposta tardia de
consulta não ressuscita um pedido cancelado nem substitui despacho/lease atuais.

A bandeja oferece **Verificar solicitação de energia** quando login/React não
estão disponíveis. Consultar não executa energia; o titular escolhe Sim no diálogo
para cancelar e recebe sucesso somente após confirmação do serviço. Esse fluxo
independe de sessão API e não autoriza agendamento; a identidade é o SID Windows
autenticado pelo serviço e o executável instalado. Nenhum SID ou broker é entregue
ao React, e os diálogos não exibem identificadores de pedidos. Uma solicitação de
outro SID não revela identificador/ação nem oferece cancelamento.

**F03 — retomada e titular:** a retomada recusa suspensão de outro SID antes de
aplicar políticas. Ausência de suspensão é idempotente; para o titular, políticas
devem ser aplicadas antes de remover a suspensão. Falha na aplicação conserva o
estado e não retorna confirmação de supervisão ativa. Reuso do número da sessão
não permite remover a suspensão de outro SID.

## Compatibilidade IPC

O pipe v2 e suas operações fixas são preservados. O `status` adiciona o campo
opcional `PowerStatusVersion: 1`; `ready`/`Active` permanecem compatíveis.
Quando há pedido do titular, os campos opcionais `RequestId`, `Action`, `ExecuteAt`
e `OriginalBrokerInstanceId` identificam o estado somente no host. Pedido de outro
SID retorna `power_uncertain` sem esses campos. Erro de armazenamento, serviço,
acesso ou corpo inválido nunca comprova ausência.

O bridge permite a nova operação fixa `cep-power/status` com payload vazio.
DTO público: `{ state: 'idle' }`, `{ state: 'unavailable' }` ou
`{ state: 'recovery-required', requestId, recovered }`. O indicador `recovered`
é obrigatório e distingue pedido recuperado de pedido conhecido do host atual.
Não há mudança de rotas, contrato, PIN, credenciais ou autorização da API.

Host novo com serviço antigo não recebe o marcador e impede inferir ausência,
agendar ou fechar protegido, indicando revisão/atualização. Renderer novo com
host antigo recebe operação não suportada, sem fabricar estado livre. Cliente
antigo pode expirar antes da resposta de serviço novo; eliminar F01 e garantir
a descoberta exige atualizar o par host/serviço. Esta entrega não gera pacote,
release ou upgrade e não comprova a versão instalada.

## Saída protegida

A reserva do fechamento começa antes do diálogo de senha, impedindo diálogos
sobrepostos e concorrência com recarga/atualização manual. Senha recusada limpa
o campo, mantém o diálogo aberto e orienta conferir a senha diária e a data do
Windows. A validação local existente permanece intacta.

Senha aceita abre uma janela de preparação visível, inclusive quando a janela
principal está na bandeja. A preparação verifica/cancela pedidos conhecidos
pelo mecanismo existente e solicita `desktop-suspend` na instalação corporativa.
Recusa `multiple_sessions`, `update_maintenance`, acesso negado, falha do serviço,
timeout, canal interrompido ou resposta inválida recebe explicação sanitizada.
Pedido incerto orienta cancelamento explícito no menu Energia. A recusa mantém
o CEP aberto; sucesso exibe confirmação antes do fechamento. Cancelar o diálogo
inicial conserva o aplicativo aberto.

A restauração dos controles Windows pela saída diária já existe na base 0.4.16;
esta entrega não modifica políticas, direitos de logon ou critérios do serviço.

## PIN administrativo e menu CEP

O menu anuncia validação, revalidação nativa, agendamento, cancelamento e resultado.
PIN inválido em formato ou recusado pela API, sessão expirada/revogada, falta de
permissão, limite de tentativas, PIN não configurado, falha de transporte e corpo
inválido recebem orientações distintas. `Retry-After` válido informa a espera;
nunca dispara tentativa automática. Sessão expirada pode desmontar o menu e
exibe o aviso existente na tela de login.

Em resposta incerta ao PIN, consultar status antes de repetir. O campo sempre é
limpo; tentativa recusada não estende uma janela anterior. A liberação continua
exatamente cinco minutos pelo relógio do servidor, para a própria conta e somente
para Desligar/Reiniciar/Hibernar dentro do CEP. O PIN não libera controles nativos
do Windows. Cada ação consulta a API e o WPF revalida antes do serviço local.

Mensagens usam catálogo fixo e identificador de suporte limitado a 100 caracteres
alfanuméricos, hífen ou sublinhado. Não exibem texto bruto de exceções ou corpos
de erro. Não há novas rotas, DTOs, persistência, logs de segredos ou repetição de
mutações com resultado incerto. HTTP continua impedindo contingência; somente
falha de transporte confirmada pelo host permite o fluxo existente.

## Validação e limites

Verificações automatizadas usam fixtures, bridge simulado e executores falsos.
O PR registra os comandos e resultados efetivamente executados. Compilação WPF
e testes de mensagens não comprovam o diálogo numa instalação corporativa real.
O driver WPF/WebView2 executado valida o host/bridge geral com API descartável;
não aciona os novos diálogos de saída diária, preparação ou confirmação.
Homologação Windows 10/11 permanece pendente: senha recusada/aceita, bandeja,
cancelamento do diálogo, tentativa sobreposta, múltiplas sessões, manutenção,
serviço indisponível, PIN/expiração e retorno acessível das mensagens.
Sem instalação, upgrade, deploy ou ação real de energia nesta entrega.
