# Auditoria do instalador Windows — 06/10/2026

Escopo: host WPF/WebView2, sessão/bridge, notificações, serviço/IPC, energia,
políticas, MSI, atualizador e scripts de distribuição. Base do trabalho:
`b467c0a2571fdb8324f99d181934e21f6d785cfa`, PR #16, draft
`installer-v0.4.12`. Branch de correção: `codex/installer-deep-cleanup`.
Esta entrega não incorpora a branch de ambiente desktop de testes, não altera
API/web em produção, não faz merge e não modifica a release 0.4.12.

## Origem e artefatos examinados

PR #16 e target do draft foram consultados novamente no GitHub. Ambos apontam
ao SHA acima. A main remota observada é `18aa262947d25f505d79501aa79aaa3f6680aa7b`;
ela não foi usada como origem do instalador. `BUILD-EVIDENCE.json` registra o
mesmo commit e a CI histórica `37347411364`; seu conteúdo não substitui os
checks desta auditoria.

| Asset original baixado | Bytes | SHA-256 |
|---|---:|---|
| MSI | 99315505 | `d50ab5284fa5558d328c6997929b87e6e673c4ac2214f8b714b078fad9489d16` |
| Kit TI ZIP | 163620866 | `2618ec713a5831f06d831f38481680f69df43379c34064fca5d1c8085fbab5df` |
| Manifesto | 183 | `34c0d0ede2864519b76365084798f38d4e063380122ba9593bdfa595cf3c758a` |
| Assinatura destacada | 384 | `8e4293b243620b0c76139d8beee500ec05a050c28b18d1ce9e45a01e091fc03f` |
| BUILD-EVIDENCE | 1208 | `762e140cdeb501b7088cca1338ec106065682e519452f9acfd57fde9962ec14a` |

Hashes calculados localmente conferem com o GitHub e o manifesto. RSA-PSS/SHA-256
verificada com a pública desta base: válida. Authenticode do MSI: `NotSigned`.
A assinatura destacada autentica o canal; não equivale a Authenticode.

O banco MSI foi aberto somente para leitura. Os dois CABs embutidos foram
exportados pelo DTF e extraídos por `expand.exe`, sem `msiexec` ou instalação.
Os 895 arquivos foram mapeados pela tabela File/Component/Directory e seus
tamanhos e hashes conferidos. Host e serviço declaram FileVersion `0.4.12.0`
e ProductVersion `0.4.12+b467c0a2571fdb8324f99d181934e21f6d785cfa`.
A pública embutida em CepHoras.Updates.dll corresponde ao código; as cópias
desktop/control dessa DLL têm o mesmo hash. Os 402 arquivos do runtime de
recuperação no ZIP correspondem ao payload control do MSI; o MSI dentro do
ZIP também tem o hash indicado acima. A varredura de nomes não encontrou
arquivos de sessão, journals, .env, chaves privadas ou certificados no payload.
Isso verifica os bytes distribuídos e a identidade declarada, sem afirmar
build reproduzível bit a bit ou instalação homologada.

Inventários locais detalhados ficam em `.local/audit-0.4.12/`; não contêm estado
de uma estação instalada. O snapshot sanitizado de integridade em
[evidência de payload](evidencias/instalador-0.4.12-integridade.json) permite
reconferir componentes e hashes sem os binários no Git.

## Achados e mudanças

| ID / prioridade | Evidência na base | Efeito e correção |
|---|---|---|
| A-01 / P1 | ApiSession construía HttpClient com redirects automáticos; IsApiUnreachable só observava o resultado final. | Um 307 podia encaminhar corpo de autenticação e uma resposta HTTP seguida de falha no destino podia autorizar contingência offline. Handler de produção agora recusa redirects. Teste com TCP loopback usa o handler real, verifica 307 e API alcançável. |
| A-02 / P1 | WindowsPower: callback de hibernação passava diretamente de Task.Delay a SetSuspendState, enquanto Cancel apenas cancelava o token. | Cancel podia confirmar sucesso depois do término da espera e antes do efeito. DelayedPowerAction serializa cancelamento/reserva; após reserva não confirma cancelamento. Falhas nativas são observadas, descarte impede efeitos pendentes e novo pedido independente funciona após retorno. Testes usam callbacks falsos e barreiras determinísticas. |
| A-03 / P2 | Hibernação não habilitava SeShutdownPrivilege antes de SetSuspendState, ao contrário das demais ações. | Habilitação ocorre antes de aceitar o agendamento. A exigência está na [documentação Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/powrprof/nf-powrprof-setsuspendstate). O caminho nativo precisa de piloto Windows; não foi invocado aqui. |
| A-04 / P1 | MsiUpdateCoordinator.InMaintenance retornava false quando Initialize falhava, inclusive na leitura do journal. | Estado desconhecido não prova ausência de manutenção. Agora impede energia e supervisão até leitura confiável; atualização fica indisponível e exige TI. Regressão cobre estado não inicializado sem criar estado SYSTEM. |
| A-05 / P2 | ProtectedJsonFile fazia WriteAllBytes/Move sem flush durável; refresh removia arquivo por unlink comum antes da chamada. | Conteúdo DPAPI e substituição agora são persistidos antes da publicação; refresh grava tombstone criptografado e durável antes de rotacionar. Fixture verifica tombstone antes do POST, ausência de replay em falha e preservação do ciphertext anterior quando publicação falha. Formato/entropia DPAPI continuam compatíveis. |
| A-06 / P2, testes | Driver WPF devolvia notificações somente com id/readAt para a mesma rota usada pela central. | Quando a UI recebia a fixture antes do receipt nativo, AnalysisDetails encontrava analysis ausente e acionava recuperação. Fixture agora segue o DTO, mantém desconhecidos nulos, distingue pendingOnly de leitura e registra paginação apenas do recebimento nativo. Sem mudanças no produto React. |
| A-07 / P2, documentação | Contexto de entrada e guia do atualizador ainda apontavam branches anteriores como base corrente. Os contratos de energia/MSI já documentavam v3. | Entrada corrente fixa 0.4.12/v3, preservação de direitos originais, draft e limites. Matrizes datadas continuam referências históricas. |
| A-08 / P2, regressão da correção A-05 | MoveFileEx recebia caminhos comuns; arquivo temporário do ledger no worktree ultrapassava MAX_PATH e falhava com Win32 3. | Caminhos completos são normalizados para a sintaxe estendida Windows, incluindo UNC. Regressão reproduziu a falha antes da correção e passou depois. |

Refatoração: MainWindow mantém criação/lifetime e coordenação; bridge está em
`MainWindow.Bridge.cs`, bandeja/saída em `MainWindow.Tray.cs` e apresentação de
atualização em `MainWindow.Updates.cs`, junto ao partial MSI já existente.
OpenWindow não usa async sem operação assíncrona. O campo diagnóstico volátil
do coordenador, nunca apresentado/consumido, foi removido; diagnósticos
persistidos/auditoria permanecem. A extensão de caminho usada uma única vez
foi substituída pela operação de Path equivalente. Os handlers existentes de
sessão, energia, política, supervisão e lifecycle já possuem fronteiras
testáveis; não foram substituídos por camadas genéricas.

## Cobertura da revisão e compatibilidade conservada

| Área | Caminhos examinados e conclusão |
|---|---|
| Sessão/organização | ApiSession, ProtectedJsonFile, ApiRoutePolicy e transporte React: DPAPI CurrentUser por origem, refresh serializado, limite de retry por 401, geração da sessão e descarte de resposta tardia. Tokens permanecem no host. Backend continua impondo organização/permissões. Snapshots e rotas não foram ampliados. |
| Bridge/WPF | Origem virtual HTTPS, documentId/generation, tamanho máximo, permissões negadas, link externo HTTPS por ação humana e Debug condicionado. Lifecycle confirma React/bridge, limita recuperação e conserva perfis próprios. Instância única permanece por sessão Windows. |
| Notificações | NotificationDelivery registra IDs DPAPI, coleta todas as páginas antes de confirmação, confere usuário entre awaits e agrupa popups. Não persiste corpo/análises nem trata receipt como leitura. Retenção de IDs depende do contrato de entrega; não foi removida como cache supérfluo. |
| IPC/identidade | ControlWire limita framing a 4096 bytes; cliente verifica PID SCM antes de transmitir. Pipe nega Network, exige identidade Interactive e caminho instalado; privilégios e operações continuam fixos. Atualização vincula aceite a SID/sessão/PID/start-time/versão. Testes exercitam token real em pipe descartável, não o serviço instalado. |
| Energia/recuperação | PowerBridgeHandler reconsulta API, separa HTTP de transporte, negocia broker e quiesce. PowerAuthority grava intenção antes do efeito, conserva tombstones e não repete intenção herdada. Cancelamento herdado permanece explícito pelo titular; recuperação/atualização não o cancelam silenciosamente. |
| Políticas/supervisão | PolicyTransaction, PolicyProfile, PolicyStore, journals, AdministrativeRecovery e DesktopSupervisor: backup/verificação/rollback, backoff, sessão ativa, manutenção e restauração exclusiva com rechecagem de outras sessões. Perfil v3 preserva os direitos LSA originais; não confundir com v2. |
| MSI | Package.wxs, geração de payload, preflight, build e inspeção: identidade/UpgradeCode/x64/ALLUSERS, downgrade, ações elevadas fixas, rollback antes da mutação, StopServices aguardado, migração e commit do checkpoint. Inspeção não executa custom actions. |
| Atualizador | MsiRelease, MsiGitHubUpdates, MsiPackageIdentity, UpdateStore/State/Recovery, coordinator e runner: assinatura antes do JSON, limites/origens/redirecionamentos, identidade MSI, ACLs privadas/reparse, lease, quota, owner, handoff, executor fora do payload substituído, timeout sem matar MSI e reconciliação de reboot/3010. |
| Publicação/legados | Scripts de chave/backup/assinatura lidos sem abrir privadas. MSIX, instalação por perfil, migração v1/v2, restauração TI e --finish-restore mantidos: são compatibilidade/canais operacionais explícitos. Ausência no menu MSI não prova código morto. |

O código 0.4.12 usa perfil v3: não remove direitos originais da conta para
construir tokens novos sem desligamento. Continua aplicando restrições de
interface/botões e veto WPF ao encerramento não autorizado. Resistência a
encerramento forçado e comportamento de tokens/GPO não foi certificada.
A possibilidade de comandos externos é consequência conhecida da escolha
humana registrada em [liberação 0.4.12](liberacao-energia-0.4.12.md), Issue #19:
liberar imediatamente ao fechar com senha diária. Esta auditoria conserva
essa decisão e não retorna ao desenho v2.

## Verificação desta entrega

Checks e resultado final devem ser lidos com a base dos commits desta branch,
não com as contagens históricas de BUILD-EVIDENCE. Os comandos não dependem
de API real, banco ou fontes para as fixtures.

| Verificação | Evidência |
|---|---|
| Control.Tests Release | PASS: ações fixas/IPC, update/maintenance, 108 verificações de confiabilidade, 41 de recuperação, 23 de migração e corridas determinísticas de hibernação; executores falsos. |
| Desktop.Tests Release | PASS: 312 verificações de sessão, DPAPI, allowlist, PIN, lifecycle, instância única, ownership, redirect, tombstone, publicação e caminho longo. |
| Updates.Tests Release | PASS: 16 verificações de atualização, 80 MSI e 4 preflight. |
| Builds | PASS: Desktop e Control Debug/Release; builds finais Release sem avisos/erros. `pnpm install --frozen-lockfile` e `pnpm build` passaram. |
| Driver WPF | PASS: `node scripts/test-desktop.mjs`, execução `run-1791259310898`; API descartável, 101 recebimentos multipágina, popup nativo, recuperação de conteúdo/JS, bandeja/retomada, recriação com perfil conservado, update falso com falha, admin, refresh único, restart DPAPI, allowlist, isolamento de tokens e logout. Energia indisponível. |
| Inicialização WPF | PASS: `node scripts/test-desktop-init-failure.mjs`, evidência `.local/desktop-init-failure/run-5acc7197-627f-4726-b2b8-60d23e61a14e/evidence.json`; HTTP remoto inválido rejeitado, sem serviço/API real. |
| Artefato original | PASS: hashes, RSA-PSS, identidade/versionamento do payload, kit e `scripts/test-corporate-msi.ps1`; nenhuma instalação. |

As primeiras execuções do driver falharam na fixture incompleta (A-06) e,
depois de sua correção, no caminho longo introduzido na publicação durável
(A-08). O resultado final acima foi obtido após corrigir ambas as causas.
`git diff --check` passou. API real, PostgreSQL e fontes não foram homologados.

MSI de inspeção local gerado por `scripts/build-corporate-msi.ps1 -Version
0.0.12012`, código `3c8f72a`: build self-contained Release e inspeção estrutural
passaram sem avisos/erros. SHA-256
`b17651c01cd06eb71edc6fb44917204f10733ac04a46afd756ce68a4da2a235e`.
Local: `.local/corporate-msi/0.0.12012/artifacts/CEP-Horas-Windows-win-x64.msi`.
A versão inferior identifica inspeção, não upgrade; não foi instalada,
assinada para atualização, publicada em release ou marcada latest.
Nenhuma chave privada foi usada/gerada/rotacionada. A release 0.4.12 permanece
intacta. O commit documental posterior não altera o payload desse candidato.

## Aceite ainda necessário em VM descartável

Preparar VM Windows 11 x64 24H2+ Pro/Enterprise/Education, snapshot anterior,
WebView2 por máquina, administrador de recuperação e conta comum de teste.
Usar versões e canal explicitamente aprovados; candidato sem assinatura de
update serve somente a inspeção. Não marcar candidato como latest.

| Ensaio separado | Evidência exigida para fechar |
|---|---|
| Instalação/upgrade/downgrade | SHA/hash/versões e retorno MSI; serviço SCM, ACLs, direitos e registros antes/depois; mesma identidade; recusa de downgrade. |
| Rollback/uninstall/reinstalação | Falha controlada após ApplyPolicy/UpgradePolicy/RestorePolicy; snapshot e checkpoint preservados/verificados; serviço e estado coerentes após rollback. |
| Manutenção/reboot/3010 | Executor sobrevivendo StopServices, instalação concorrente recusada, nenhuma restauração via desktop-suspend, journal consistente antes/depois de reboot e retomada sem inventar commit. |
| Sessões simultâneas | Conta comum console/RDP, outra sessão impede restauração global/troca; abrir novamente reaplica proteção. |
| Sessão/recuperação | Login/refresh/logout com API de homologação, pending multipágina/restart, popup, falha de renderizador, recarga e perfil conservado. |
| Energia autorizada | TI deve conduzir ensaio real em VM exclusiva com trabalho descartável, incluindo limites de cancelamento/hibernação e pedidos herdados. Este computador de trabalho não executa essas ações. |
| Proteção v3 | Direitos originais, token antigo versus novo logon, veto WPF e caminhos externos/forçados avaliados; registrar alcance real, GPO e lacunas. |
| Distribuição/chave | Canal estável e upgrade aprovado, assinatura/identidade rejeitando adulteração, recuperação externa da privada em perfil separado sem publicar material secreto. |

Nenhum resultado de build/fixture fecha esses aceites. O trabalho entrega
código e evidência revisáveis; rollout, release estável e merge requerem sua
própria autorização e homologação.
