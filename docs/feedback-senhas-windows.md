# Avisos de senha diária e PIN de energia

Entrega da [Issue central #34](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/34),
na branch `codex/password-feedback`, baseada na tag `installer-v0.4.16`,
commit `f197abbf1efab81a42a80967e0fd25e759d37054`.
Esta alteração não gera nova versão MSI nem declara publicação ou instalação.

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
