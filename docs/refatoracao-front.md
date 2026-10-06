# Refatoração estrutural do Front

Entrega de 06/10/2026, America/Sao_Paulo. Continuação da [auditoria e limpeza](mapa-front-limpeza.md), no worktree isolado `CEP-FRONT-deep-cleanup`, branch `codex/front-deep-cleanup`. Base recebida `02f7b6143a9939d6a15b12fa2b4472c61d9b207e`, limpa; código final `1463382be89edc7e14e552f762616decefa9fd56`. Não representa integração à main, publicação em produção ou versão Windows instalada.

## Objetivo e resultado

Separar apresentação, navegação e controle assíncrono nas áreas de conta, histórico e sincronização, preservando o comportamento existente. O trabalho aplica responsabilidade única e interfaces menores onde há consumidores concretos; não adiciona camadas genéricas, novas regras de negócio ou funcionalidades planejadas.

| Commit selecionável | Mudança e conservação |
|---|---|
| `02f7b61` | `AccountControls` compartilha apresentação de conta em Admin/User; `useLogout` delega à submissão única de `useAction`, chama o callback somente após sucesso e conserva erro no shell. Classes, fallbacks, sino e ordem dos filhos preservados. Commit herdado, revisado e validado nesta entrega. |
| `3eb1c9d` | `TeamHistory` sai de `UserShell`; conserva consulta de vínculos, seleção local, keys por time/pessoa, fallback e apresentação. O shell continua responsável pela navegação e pelo contexto selecionado. |
| `6bcbe06` | `HistoryFields` compartilha período e fonte em `HistoryPage`/`HistoryView`. IDs `history-*` e `user-history-*`, labels, ordem, opções, required/min, invalidação e botão específico de cada tela preservados. Busca administrativa, textos e regras de consulta permanecem nos respectivos consumidores. |
| `8ae4818` | `AdminApi` e `NotificationApi` recebem `Pick<AuthClient, 'request'>`; fixture de notificações deixa de forçar conversão para cliente de sessão completo. Métodos, rotas, payloads e escopo não mudam. |
| `1463382` | `useSynchronization` concentra estado, submissão, polling, descarte por revisão, conflito e callback de conclusão. `SyncPage` mantém apresentação administrativa e pessoal. O trecho de controle movido foi comparado integralmente com o original; `reloadLatest` encapsula a referência privada antes manipulada pelo botão. |

## Aceite e verificações executadas

- Lint aprovado, 100 testes unitários aprovados e build TypeScript/Vite aprovado no código final.
- 220 testes Playwright aprovados em desktop/mobile, Vite isolado na porta 5193, sem reutilizar servidor existente. A suíte cobre histórico pessoal/administrativo, liderança/perda de vínculo, respostas atrasadas, reprocessamento parcial com filtros atuais, conflito de sincronização, sessão/logout, sino, notificações, download e as demais jornadas de fixtures.
- `git diff --check` aprovado; snapshots real/consumido e tipos gerados mantidos. Rotas dos recursos conferidas nos dois snapshots.
- Build Docker aprovado; `config --quiet` dos dois Compose e `nginx -t` dos dois Fronts aprovados.
- HTTPS com validação normal: `/download`, JS `/assets/index-CWZeaC86.js`, CSS `/assets/index-HeSmQOcp.css` e `/healthz` retornam 200 em 8443/9443; `/api/v1/me` anônimo retorna 401. Bundle conserva botão pessoal e sua descrição e não inclui as assinaturas conferidas de fixture/prévia DEV.

Os testes de navegador usam API de fixtures. As verificações anônimas nos Docker comprovam a troca do Front e o encaminhamento protegido, sem homologar contas, fontes reais, SMTP, cálculos de negócio ou operação diária. Testes de energia da suíte permanecem simulados. Nenhum C#/XAML/WiX, bridge ou serviço nativo foi modificado; instalação/upgrade MSI e checks nativos não foram repetidos.

## Aplicação somente nos Docker de teste

Imagem `cep-front-refactor:1463382`, ID/digest inspecionado `sha256:178154ba66832244fbd493cee001a85fb07f7fb9218333860d648b13e499d956`, label `org.opencontainers.image.revision=1463382be89edc7e14e552f762616decefa9fd56`, usuário `nginx`.

Somente `front` dos projetos `cep-test` e `cep-mock` foi recriado, com `up -d --no-deps --no-build front`, após aprovação dos checks. Os Compose privados tiveram backup e somente a referência da imagem Front foi substituída. Os nove contêineres de API, PostgreSQL, proxy, Mailpit e fontes simuladas conservaram IDs e imagens antes/depois. Volumes, contas, configuração das fontes e painel coordenador preservados.

A imagem anterior `cep-front-cleanup:1c67a1d` permanece disponível para retorno operacional. Nenhum comando de reset, exclusão de volume, reimportação, envio/leitura de aviso ou ação de energia foi executado contra os stacks nesta troca. O executor da API trabalha separadamente; este trabalho não construiu nem substituiu sua imagem.

## Limites de seleção e integração

Commits foram mantidos por tema para revisão e seleção posterior. O código final inclui as entregas anteriores de senha mínima 6, sincronização normal 17/administrativa 90, detalhe mínimo das fontes, sino e download simplificado da base web de teste. O painel coordenador, os métodos ativos dos clientes, compatibilidade HTTP e classes dinâmicas permanecem.

A linha desktop mock `05f9d82` continua divergente e não foi integrada. Não houve produção, merge, release, MSI ou energia real. Main, CI remota, produção, pacote Windows e testes locais são evidências distintas. Candidatos preservados e razões para não apagar rotas/telas/canais permanecem no mapa de limpeza.
