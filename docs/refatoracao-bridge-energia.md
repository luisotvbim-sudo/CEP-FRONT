# Bridge de energia e coordenação com recuperação

Entrega de código na branch `codex/installer-reliability`, a partir de `1911a317dda45e10cd2302af97e8bdfe9a385a61`. Demanda central: [CEP-ORQUESTRADOR #14](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/14). Este registro cobre a implementação do bridge e seus testes em 04/10/2026; instalação, atualização elevada e energia real continuam exigindo piloto autorizado.

## Achados corrigidos

Referência de manutenção posterior: na branch `codex/windows-password-refactor`,
sobre PR #29 `cebc15b`, o wrapper `CancelCurrent` citado no achado histórico
abaixo foi retirado por não ter chamadas em produção. O sucessor para lifecycle
continua sendo `QuiesceAsync` com lease; testes obtêm/descartam o lease localmente.
O estado persistido e a descoberta de pedidos seguem o
[contrato Windows atual dessa base](feedback-senhas-windows.md), sem mudar o
registro de implementação e suas lacunas datadas em 04/10.

- O prazo de cinco segundos de `NativePowerBridge` encerrava a espera antes do orçamento real de revalidação nativa da API, refresh de sessão, probe de transporte e IPC. A resposta perdida podia deixar a interface em cancelamento incerto durante uma operação ainda em curso.
- `PowerBridgeHandler` guardava o identificador somente após a resposta de agendamento. Recuperação/logout durante autorização ou IPC não tinham um identificador para reconciliar. `CancelCurrent` também descartava o identificador sem validar a resposta de cancelamento.
- Uma conclusão de agendamento antiga podia restabelecer permissão de encerramento após cancelamento. A autorização nativa, a intenção de cancelamento e o dispatch não tinham uma transição comum.
- O contador do React terminava sem reconciliar o pedido, deixando novas ações indisponíveis após hibernação/retomada. O relógio do renderer não comprova execução ou cancelamento.
- Auth e energia duplicavam listener, correlação, timeout e cleanup. O adaptador de sessão aceitava metadados nativos sem validar identidade, papel e validade temporal.

O serviço já possuía tombstones de cancelamento por `requestId`. Não foi demonstrado um bypass que execute ação depois de um cancelamento aceito. A refatoração mantém essa proteção e acrescenta uma trava local antes do dispatch.

## Fronteiras e invariantes

`PowerBridgeHandler` reserva o identificador e a identidade da conta antes do primeiro await. Só uma solicitação fica ativa. Depois da revalidação, o handler verifica novamente a identidade, a solicitação atual, o pedido de cancelamento e a suspensão antes de iniciar IPC. Uma conclusão antiga não substitui nem descarta a solicitação nova.

`QuiesceAsync(CancellationToken)` devolve um lease `IAsyncDisposable` que deve abranger navegação, destruição/recriação do WebView2, reinício do host, logout, saída protegida ou manutenção. A suspensão acontece antes do primeiro await. A consulta inicial confere a identidade atual do broker. Para pedido da mesma instância, o host envia cancelamento pelo identificador conhecido, inclusive durante autorização, e só devolve o lease quando recebe `cancelled: true`, código `cancelled` e o mesmo identificador. Se a instância mudou após dispatch, o host conserva o pedido como herdado e bloqueia recuperação; lifecycle/logout/manutenção não cancelam esse pedido automaticamente. O lease permite suspensão aninhada e descarte idempotente. Falha conserva o identificador e mantém novos agendamentos bloqueados até confirmação adequada. Cancelamento da espera não representa confirmação do serviço.

Quando a interface tenta novo agendamento enquanto o host já conserva outro, o erro devolve o identificador existente. O adaptador o conserva para o botão **Cancelar**, sem cancelar automaticamente o pedido anterior durante uma nova tentativa. O cancelamento explicitamente solicitado pelo usuário pode aceitar a prova original descrita abaixo. Sem pedido conhecido, a consulta por `status` não comprova ausência de uma ação do Windows sobrevivente a um crash anterior do host/serviço.

O sucesso de `schedule` exige código, identificador, ação e prazo correspondentes. Falha depois de iniciar IPC conserva o pedido porque pode ter ocorrido efeito no serviço. `cancel` só devolve sucesso depois da confirmação correspondente; não suprime falhas de IPC.

`reconcile` no bridge consulta `power-status` no serviço pelo identificador. Durante autorização, ou dispatch ainda sem confirmação, o host conserva o estado pendente local: uma consulta por outro pipe poderia chegar antes de um agendamento em voo. Um agendamento confirmado é liberado por resposta terminal correspondente do serviço; um tombstone confirmado também encerra o estado. Respostas com outro ID, corpo inválido ou ausência sem confirmação anterior permanecem incertas.

A autorização completa negocia `BrokerInstanceId` por `status` antes de qualquer agendamento. A identidade é um UUID criado por instância do serviço e acompanha os requests e responses do protocolo local, em campos opcionais acrescentados sem reutilizar versão de atualização. Agendamento, cancelamento e consulta enviados pelo host carregam a identidade negociada. Uma resposta terminal de outra instância não confirma aborto de uma ação que o Windows possa ter conservado após crash; o host mantém a incerteza e bloqueia recuperação. A única exceção é `cancelled` com `Cancelled: true`, o mesmo pedido e `OriginalBrokerInstanceId` correspondente ao broker original, produzido pelo serviço após confirmar aborto e persistir a prova no journal. `not_pending`, outro ID/epoch e um booleano falso não superam a troca de broker. Um serviço antigo sem identidade negociável não recebe o agendamento novo. O journal e a restauração no início do serviço complementam esse limite e devem ser avaliados com os testes da frente de serviço/MSI.

O consumo dessa prova e seus casos de sucesso/falha estão implementados no host e cobertos por fakes. A integração de journal/aborto de recuperação no serviço ainda não foi aplicada nesta execução: o serviço de produção conserva a recusa `broker_changed` após troca de instância. O campo opcional não significa que já exista emissão de prova durável. Até essa integração, um restart do broker pode conservar o host em estado incerto, sem recuperação automática que alegue cancelamento.

Também não foi integrada a alternativa de ler journal e bloquear pedidos herdados sem efeitos na inicialização. Portanto um **novo processo** de host/serviço ainda pode desconhecer o identificador de uma ação do SO anterior ao crash; a negociação de epoch protege pedidos que o host vivo conserva, mas não implementa bloqueio durável entre processos novos. Não declarar essa lacuna resolvida pelo campo de protocolo, pelo preflight ou pelos fakes.

O React consulta depois de vencer o contador, no foco/retomada ou enquanto o pedido está incerto. Somente `state: terminal` confirmado pelo host libera o menu. Vencer o contador não executa novamente nem presume aborto. A mensagem terminal informa apenas que a ação deixou de estar pendente.

Shutdown/restart confirmados abrem uma permissão breve de encerramento da sessão Windows. Ela dura até o prazo confirmado mais 60 segundos, limitada a 70 segundos desde a confirmação e medida por relógio monotônico. Isso evita vetar `WM_QUERYENDSESSION` que chegue depois de o serviço informar término, sem permitir janela indefinida por ajuste do relógio civil. Hibernar não abre essa permissão; suspensão para recuperação e cancelamento confirmado a invalidam.

## Orçamentos por operação

| Operação | Host | Renderer |
|---|---|---|
| Agendar | Autorização completa, incluindo preflight do broker, limitada a 65 s; IPC final limitado a 9 s | 80 s |
| Verificar transporte da API | Probe já limitado a 5 s | 7 s |
| Cancelar/reconciliar | IPC limitado a 9 s; não espera autorização da API | 12 s |
| Suspender para lifecycle | Consulta de broker até 9 s e cancelamento conhecido da mesma instância até 9 s | Espera nativa finita/cancelável; não inclui ação automática sobre pedido herdado |
| Auth padrão, incluindo logout | Revalidação API e eventual quiescência; origem/documento conferidos pelo host | 65 s |
| Login/restore nativo | Refresh/login e leitura de conta podem usar duas chamadas de 20 s, além de verificação do documento e persistência | 60 s |

`ControlClient` conserva seu limite interno de oito segundos. O limite total de autorização também abrange esperas por refresh e revalidação. Se esse limite expirar, a tarefa de API pode concluir depois, mas seu resultado não tem caminho para dispatch. Não se repete silenciosamente agendamento: no resultado incerto, o adaptador tenta cancelar pelo mesmo identificador e o conserva se não houver confirmação.

## Transporte e sessão

`src/auth/bridge-transport.ts` centraliza chamadas nativas com um listener por bridge, `Map` de pedidos, identificação aleatória, deadlines independentes, remoção ao concluir/expirar e descarte explícito de chamadas pendentes. Auth e energia preservam seus próprios validadores e mensagens. Envelopes incoerentes, `ok` truthy, tipos inválidos de erro e sucesso com erro anexado são recusados. O transporte não repete gravações nem registra payloads.

Cada envelope Auth/Power inclui `documentId`, lido de `window.__CEP_DOCUMENT_ID__` gerado pelo script nativo por documento. O handshake e o host comparam essa identidade com o documento corrente antes de aceitar pedidos. Capturar apenas a geração ao receber o evento não provaria a origem de uma mensagem antiga já enfileirada durante reload do mesmo CoreWebView2. O transporte conserva também o UUID independente de cada chamada, sem reusar a identidade do documento para correlacionar respostas.

O adaptador de sessão valida UUID, papel do contrato, campos usados pela interface e expiração finita/futura antes de expor metadados. Tokens inesperados no envelope de sessão são recusados. Nenhum token, PIN ou dado de horas é persistido pelo renderer. Origem e allowlist continuam responsabilidades do host; autorização, cálculo de horas e decisão continuam na API.

Não houve mudança de endpoint/schema da CEP API. Os snapshots OpenAPI e tipos permanecem iguais. Qualquer resposta HTTP, inclusive 503 ou corpo interrompido após headers, impede contingência; apenas falha de transporte independente confirmada pelo host permite a contingência já existente.

## Evidência desta implementação

Executados no worktree isolado com Node/pnpm do ambiente e .NET SDK 10.0.401 local:

- `node node_modules/vitest/vitest.mjs run src/power src/auth/desktop-auth-client.test.ts src/auth/bridge-transport.test.ts --exclude '**/.local/**'`: 53 testes aprovados. A exclusão evita coletar novamente fontes copiados para staging de empacotamento.
- `node node_modules/typescript/bin/tsc --noEmit`: aprovado.
- ESLint dos arquivos de bridge/energia e browser correspondente: aprovado.
- `dotnet run --project desktop/CepHoras.Desktop.Tests -c Release`: 274 verificações aprovadas na suíte combinada. Testes de energia usam HTTP, IPC e relógio falsos, incluindo ausência/troca da identidade do broker, bloqueio sem cancelamento automático de pedido herdado, prova original válida/inválida, cancelamento pré-dispatch com tombstone e permissão monotônica de encerramento.
- `node node_modules/@playwright/test/cli.js test tests/browser/power.spec.ts --project=desktop --workers=2`: 27 testes aprovados em Chromium 1243, com `PLAYWRIGHT_BROWSERS_PATH` dentro de `.local/ms-playwright` do worktree e porta isolada 5186. Cobrem reply acima de cinco segundos, retomada de hibernação, manutenção do contador sem reexecução, cancelamento, PIN e distinção HTTP/transporte.
- Após acrescentar identidade de documento e ajustar a sincronização da fixture de atraso, o filtro `native revalidation exceeding|same interface uses native` de `power.spec.ts` e `login.spec.ts` passou em desktop e mobile: quatro cenários. A fixture espera o dispatch antes de avançar o relógio, para não confundir uma chamada HTTP ainda em curso com o prazo nativo.

Antes de instalar o Chromium local, a primeira tentativa de browser não chegou ao produto porque o executável de teste estava ausente. O retry com runtime local acima concluiu os cenários. A primeira compilação .NET coincidiu com uma alteração em andamento dos testes de perfil; a suíte final acima passou depois da integração.

Não houve comando real de desligamento/reinício/hibernação, aplicação de políticas, provisionamento de PIN, instalação MSI elevada, upgrade ou validação de fontes reais. O comportamento de energia e cancelamento sob GPO, Windows suportado, suspensão real, múltiplas sessões e falhas do serviço exige [homologação #7](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/7) e a matriz da demanda central. A evidência do journal, do aborto de pedido recuperado e da durabilidade do serviço pertence à frente correspondente; a troca de epoch sozinha não comprova aborto no Windows.
