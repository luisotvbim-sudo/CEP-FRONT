# Refatoração do instalador — piloto 0.4.10

Demanda de 04/10/2026, São Paulo: [CEP-ORQUESTRADOR #14](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/14). Branch `codex/installer-reliability`, checkout isolado gerenciado `installer-reliability/CEP-FRONT`, base conferida `1911a317dda45e10cd2302af97e8bdfe9a385a61` (`codex/contexto-instalador-atual`). Nenhuma alteração na main compartilhada, merge, instalação elevada ou ação real de energia pertence a esta entrega.

## Responsabilidades e comportamento

`WebViewLifecycle` é o estado testável de boot/liveness, com relógio monotônico, NavigationId, geração e token novos a cada documento. `WebViewRecoveryPlan` limita a escalada. `MainWindow.WebView` compõe WPF/WebView2 e o coordenador de energia; `WebViewProfileRecovery` resolve e protege o perfil real; `WebViewProcessOwnership` captura/revalida identidade e ancestralidade. API e estado de autenticação não entram na decisão de saúde local.

O primeiro frame é nativo, inclusive durante espera pelo processo anterior/lock. HTML navegável não encerra loading. O componente React precisa montar e responder ao challenge versionado enviado pelo host com root visível e sem falha de assets/render. O boot tem prazo de 30 segundos; criação do browser tem orçamento total de 20 segundos. Heartbeats partem do host a cada segundo, sem depender de timers do renderer; seis segundos sem resposta depois da montagem indicam bloqueio local. Três respostas com root vazio indicam tela branca. Falhas do processo, bundle ou ErrorBoundary também acionam recuperação. Retomada do Windows renova grace; falha HTTP/401/500 com renderer saudável não provoca reinício.

A escalada automática faz duas recargas (esperas de 1/3 segundos), recria o controle no mesmo perfil (8 segundos) e tenta um restart do próprio host (15 segundos). Um arquivo de orçamento bloqueia outro restart automático por dez minutos, inclusive após relançamento pelo supervisor. Sessenta segundos de saúde contínua renovam o plano local. Ação manual permanece disponível quando o orçamento acaba. Troca de perfil é ação separada, conserva backup e nunca apaga arquivos da sessão DPAPI.

Falha na configuração/armazenamento antes de preparar a sessão permanece no painel nativo, sem criar browser, anunciar ready ou tentar recriar somente a interface. O usuário corrige a configuração e reabre o aplicativo. Timeout da criação nativa não comprova cancelamento da operação subjacente: o host bloqueia outra criação/perfil nesse processo e orienta reabrir/solicitar suporte. Heartbeats continuam durante download de atualização; só o fechamento para instalação pausa a verificação, evitando declarar uma página saudável travada por uma pausa artificial.

Antes de reload/recreate/restart, saída protegida, logout e manutenção, `QuiesceAsync` bloqueia dispatch e confirma cancelamento do ID de energia no serviço. Falha conserva a incerteza e impede destruir a página. A interface permanece recuperável para tentar de novo. [Bridge e energia](refatoracao-bridge-energia.md) descreve orçamento, reconciliação e identidade do broker.

Lista de processos do ambiente WebView2 abrange todo o perfil; não constitui prova de ownership. A seleção exige browser filho direto deste host, membro da lista do ambiente, imagem WebView2, sessão, horário de criação e descendência. Após dispose normal, handles dos processos remanescentes são fixados e a identidade é revalidada antes de kill individual, sem kill de árvore ou busca por nome. Deadline/erro de encerramento impede avançar. Nenhum peer host, Edge de terceiros ou serviço é encerrado por essa recuperação. Referências primárias: [GetProcessInfos](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2environment.getprocessinfos) e [eventos de navegação](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/navigation-events).

O perfil possui lease de arquivo exclusivo e marcador ligado ao caminho. Overrides existentes sem ownership não são convertidos nem movidos. Alvos raiz/reparse points são rejeitados. Request e backup ficam ligados ao mesmo UDF real; falha de mover/deletar retorna `Failed`, conserva request e não anuncia recuperação. Instância primária é posse do mutex, inclusive abandonado com handles secundários vivos; um atalho secundário não pode resetar o perfil.

Intenção de abrir inbox é conservada no host até confirmação de consumo pelo shell autenticado, atravessando boot/login/reload. Transporte nativo correlaciona listeners e descarta respostas de outro documento. Consultas em polling conservam conteúdo/foco da mesma chave e ocultam dados antigos imediatamente quando conta/organização/filtro mudam; [evidências](refatoracao-consultas.md).

O consumo da intenção é confirmado pelo effect da Inbox após commit, inclusive quando ela já está aberta. O host exige documento corrente pronto; apenas chamar o setter de navegação não apaga a intenção. O teste negativo com a implementação anterior reproduziu confirmação antes de existir Inbox no DOM.

## Serviço, MSI e atualização

[Serviço/MSI](refatoracao-servico-msi.md) registra persistência privada durável de políticas/atualização, restauração após StopServices, cancelamento conservador por identidade do broker, supervisão por sessão, IPC administrativo estreito, lease/quota do atualizador e instalação real descoberta pelo SCM. O journal de energia preparado não é consumido em produção. [Atualizador](refatoracao-atualizador.md) registra cancelamento antes da publicação do pacote, paths, flush físico e preflight da chave pública.

MSI preserva UpgradeCode, fabricante, escopo por máquina e trust embutido. Preflight rejeita Windows/edição incompatível e ausência de Evergreen WebView2 por máquina antes de restringir energia. A mensagem exige instalar o Runtime oficial; [download Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/). O pacote não instala silenciosamente outro software. Remoção/repair de instalação existente continuam possíveis se o Runtime sumir.

## Limites de aceite

O MSI 0.4.10 é piloto novo, self-contained, sem assinatura Authenticode ou manifesto de atualização assinado nesta execução: não é release estável nem habilita distribuição automática. Certificado/chave privada de publicação não foram acessados. Hashes e evidências do build ficam junto ao artefato e no registro final desta entrega.

**Energia após crash do serviço não está homologada.** O broker mantém pending/tombstones em memória. O host antigo conserva seu ID e epoch, recusa confirmação falsa por uma nova instância e não cancela automaticamente um pedido herdado. Um novo WPF ainda desconhece uma ação do SO iniciada antes do crash: não há bloqueio durável de novos agendamentos/manutenção nesse cenário. Três propostas de integração foram rejeitadas pela revisão automática, inclusive a alternativa de somente ler/bloquear no startup; nenhuma foi aplicada. O [relatório do serviço](refatoracao-servico-msi.md) contém as razões literais e algoritmos pendentes. Não foi executada nem ocultada uma chamada automática de cancelamento em outro fluxo.

Suporte corporativo continua Windows cliente x64, build ≥26100, Professional/Enterprise/Education. Windows 10/Home/Server e edições antigas exigem trabalho de compatibilidade; não foram liberados por retirar proteção. Mesma conta Windows em sessões simultâneas ainda disputa sessão DPAPI/perfil e falha de maneira conservadora; múltiplos usuários e efeitos globais de política exigem piloto. O supervisor responde a sessões/processos; responsividade do Dispatcher WPF preso fora do checker continua pendência de watchdog externo. Suspensão/retomada real, GPO, hibernação, WebView2 ausente em máquina limpa e integridade de todos os subprocessos precisam de homologação.

A restauração do uninstall conserva evidência/journal residual validado; commit que execute EXE já removido não foi introduzido. Reinstalação só reconcilia estado anterior verificável. Instalação/upgrade/repair, rollback em cada fase e remoção/restauração reais permanecem aceite elevado em VM/PC autorizado. Os testes usam executor falso, arquivos temporários, mocks e driver WPF isolado; não comprovam fontes Monday/VR, banco ou implantação de produção. API local não respondeu à verificação desta execução; contratos OpenAPI permanecem inalterados.

Centralizações de shells/filtros/formatação sem defeito comprovado foram mantidas fora do piloto para evitar mudanças de escopo durante a entrega do novo instalador. O PR é draft empilhado sobre a base documental conferida; PR #9 continua dependência de integração e nenhum merge está autorizado.

## Verificações

Build novo concluído em 05/10/2026 a partir do commit de código `dd5feb02a6e8173614432087f35121946fa994c0`, com checkout limpo. SDK portátil oficial .NET 10.0.401, com SHA-512 conferido, e Chromium Playwright ficam exclusivamente em `.local`; Node/pnpm seguem o lockfile. Nenhum MSI foi instalado, nenhuma política do Windows aplicada e nenhuma ação real de energia executada.

| Verificação | Resultado |
|---|---|
| `pnpm lint` e `pnpm build` | PASS; TypeScript e Vite |
| `pnpm exec vitest run src --exclude '**/.local/**'` | 97 testes PASS; exclusão das cópias de baseline |
| Playwright completo | 192 casos desktop/mobile PASS |
| Playwright após ACK da Inbox | 22 casos de notifications/lifecycle PASS; 28 casos de notifications/refactor também PASS |
| `dotnet run --project desktop/CepHoras.Desktop.Tests -c Release` | 274 verificações PASS |
| `dotnet run --project desktop/CepHoras.Control.Tests -c Release` | 108 verificações de confiabilidade e duas suites legadas PASS |
| `dotnet run --project desktop/CepHoras.Updates.Tests -c Release` | MSIX 16, MSI 80 e preflight 4: PASS |
| `node scripts/test-desktop.mjs` | WPF/WebView2 real PASS: loading, root/HTML vazio, JS bloqueado, recuperação após download simulado falho, bandeja/resume, recriação no mesmo perfil, allowlist, DPAPI e logout |
| `node scripts/test-desktop-init-failure.mjs` | Falha de configuração antes da sessão: diagnóstico nativo, processo preservado por 2,2 s, sem browser/ready/recovery/perfil/sessão; encerrado somente o filho do teste. Não inspeciona visualmente os botões por UIA |
| `./scripts/build-corporate-msi.ps1 -Version 0.4.10` | Release win-x64 self-contained; WiX sem erros/avisos; tabelas MSI PASS |
| Contratos | `docs/openapi.json`, snapshot real e `src/auth/api-schema.d.ts` sem alterações |

Os cenários nativos usam fixture sem marker de instalação gerenciada e sem acesso ao serviço privilegiado. O handler de energia só é criado em instalação gerenciada; uma instalação desktop sem serviço conserva reload/logout operantes.

Artefatos locais no checkout gerenciado, em `.local/corporate-msi/0.4.10/artifacts/`:

- `CEP-Horas-Windows-win-x64.msi`: 99.593.662 bytes; ProductVersion `0.4.10`; Authenticode `NotSigned`; SHA-256 `beb2f5162f7caf4902793e74d3e168457fbe85bf483695ac6926e076ca06c109`.
- `CEP-Horas-Windows-0.4.10-TI.zip`: 164.036.832 bytes; SHA-256 `0eca4445f3949157ad4bdafaa1f43b43ba1ae4e96ada0d315f8ec4bba057902d`; inclui MSI, guia TI sem fórmula/valor de fechamento, hashes e ferramenta de recuperação.
- `BUILD-EVIDENCE.json`: SHA de origem/base, versão, tamanho, hashes, assinatura, propriedades MSI, resultados e limites. Está junto aos artefatos, fora do ZIP já gerado.
- `SHA256SUMS.txt`: hash do MSI. Não há manifesto/assinatura do canal automático neste build.

UpgradeCode conferido `{8D0D0DC8-E744-42E7-A57A-20F489145ED8}`; ProductCode deste pacote `{E47F8D44-51A8-4BF3-AC29-0FA5AA927BE2}`. Inspeção de tabelas confirmou preflight Windows/WebView2 antes da transação, serviço LocalSystem, stop/aguardo antes de restore/remove, rollback, ACL e payload. Não comprova comportamento elevado em uma instalação real.

## Conferência do PR e da entrega

[PR draft #13](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/13), base `codex/contexto-instalador-atual`, contém código `dd5feb0` e registro do build `3e9242f`. A cópia central em `CEP-ORQUESTRADOR/.local/entregas/cep-horas-0.4.10/` foi conferida por SHA-256 e é idêntica ao MSI original. O pacote continua `NotSigned` e imutável; mudanças posteriores de documentação/verificação não alteram a origem de seu código nem constituem outro build/release.

Na [CI inicial](https://github.com/luisotvbim-sudo/CEP-FRONT/actions/runs/37257852693), `desktop` passou. `validate` passou lint, Vitest e build, mas o E2E terminou com 193/194: auditoria de contraste do preview desktop mediu `4.47:1` durante a transição de fundo de um botão, frente ao mínimo `4.5:1`. Os estilos do preview não foram alterados em relação à base `1911a31`; o snapshot ocorreu antes do fim da transição existente. O ajuste se limita ao teste, aguardando animações da navegação antes da auditoria de estados assentados, conservando todas as regras Axe. A CI seguinte deve ser conferida no PR antes de promover o draft; os resultados locais anteriores não são tratados como aprovação dessa CI.

O probe local observou `4.4759:1` a 12–22 ms da troca, com animação ativa; depois de 205 ms, as animações terminaram e o contraste foi `5.0434:1`. O contraste breve preexistente foi preservado, sem correção CSS neste pacote. O teste ajustado passou seis repetições desktop/mobile, mais lint e diff-check; não usa sleep fixo, redução global de movimento ou exclusão de regra Axe.
