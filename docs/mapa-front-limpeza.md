# Mapa do Front e limpeza de código

Auditoria iniciada em 05/10 e concluída em 06/10/2026, America/Sao_Paulo. Este mapa descreve a base de testes `51b37ed6a3cde1f19e334c8c166e2062dca67e53` e a limpeza em `codex/front-deep-cleanup`. Não certifica a versão em produção ou instalada.

## Bases que não devem ser confundidas

| Base | Evidência e limite |
|---|---|
| Web de teste `51b37ed` | Simplificação do download sobre `3b32ffe`; inclui sino, histórico com reprocessamento e senha mínima 6 |
| Main remota `8f0c44a6825f8af74ebe63ea75cac08e7ed83a5d` | Conferida por `git ls-remote origin refs/heads/main`; não incorpora automaticamente as entregas de teste |
| Desktop mock `05f9d82bdde8c6418b699d2aad148dcd1362c168` | Linha divergente `codex/desktop-test-environment`; não integrada nesta limpeza |
| MSI / produção | Não publicados, instalados ou homologados nesta auditoria |

## Entradas e navegação

`index.html` → `src/main.tsx` → download público, prévia DEV ou `App`. A decisão desktop exige marcador e bridge; ausência de bridge nativa não habilita transporte HTTP alternativo. `DesktopLifecycle` acompanha readiness/erro do renderer.

| Área | Entrada / telas | Dados e operações |
|---|---|---|
| Pública | `LoginForm`, `RecoveryDialog`, `InvitationDialog`, `DownloadPage` | Login/recuperação/ativação; download sem sessão nem chamada API |
| Membro | `UserShell`, `PersonalOverview`, `HistoryView`, `Analyses`, `NotificationBell` / `Inbox` | Resumo pessoal ao vivo; histórico importado; snapshots; caixa pessoal |
| Líder | Mesmo shell, `TeamHistory`, análises dos times | Times e pessoas visíveis segundo autorização atual da API |
| Coordenador | `AdminShell`, `PeoplePage`, `InvitePage`, `SyncPage`, `TeamsPage`, `HistoryPage`, `UsersPage`, `AuditPage` | Associação por IDs, convite/reenvio, sincronização, vínculos, usuários e auditoria |
| Avisos / configuração | `NotificationSettings`, `SendNotification`, `Inbox`, `Analyses`, `AnalysisDetails` | Configuração global, agendas, prévia/envio explícito, leitura e snapshots |
| Administrador técnico | `SystemAdminShell` → seleção de organização / `AdminShell` | Código e contrato ainda possuem `systemAdmin`; decisão de produto de limitar a coordenador requer reconciliação API, provisionamento e migração |
| Energia | `AuthenticatedLayout` / `PowerMenu` | API decide, host revalida, serviço executa; browser não executa energia |
| Prévia | `src/preview/AnalysisPreview.tsx` | Import dinâmico somente DEV, sem fonte real; não é tela do produto |

Jornada, histórico e análise têm cortes distintos: resumo atual, importação e snapshot persistido. Sem autorização específica de redesenho, a sobreposição de apresentação não torna uma dessas telas código morto.

## Clientes, contrato e transporte

| Responsabilidade | Código / consumidor |
|---|---|
| Sessão comum | `AuthClient` em `src/auth/auth-client.ts`; `App` e formulários |
| Web | `HttpAuthClient`, cookie protegido de mesma origem, access token em memória |
| Desktop | `DesktopAuthClient` / `bridge-transport.ts` → `ApiSession` / `ApiRoutePolicy`; DPAPI no host |
| Administração | `AdminApi`: os 20 métodos possuem consumidores em telas, hooks ou no próprio `visiblePeople` |
| Avisos / snapshots | `NotificationApi`: os 13 métodos possuem consumidores em telas, hooks ou testes correspondentes |
| Jornada | `OverviewApi` / `useOverview`: periodização e conteúdo retornados pelo backend |
| Energia | `src/power/api.ts`, `native.ts` e `PowerBridgeHandler`; validação fechada preservada |
| Paginação / concorrência | `src/api/query.ts`, `src/hooks/async.ts`, `useHistory`; descarte de respostas antigas e submissão única preservados |
| Tipos | `src/auth/api-schema.d.ts` gerado de `docs/openapi.json`; snapshot real separado em `openapi-backend-current.json` |

O grafo de imports estáticos, reexports e imports dinâmicos relativos a partir de `src/main.tsx` alcança 52 módulos TypeScript/TSX, incluindo a prévia DEV. Fora dele estavam somente os testes e a fixture de jornada. Ausência de referência web não comprova endpoint morto: `/me/notifications/received`, por exemplo, é chamado pelo worker nativo. Nenhuma rota, método HTTP, schema ou permissão do bridge foi removido.

## Desktop, assets e operação

| Área | Entrada e conservação |
|---|---|
| Host | `desktop/CepHoras.Desktop/App.xaml`, `MainWindow` e arquivos parciais, projetos/tests .NET |
| Avisos nativos | `NotificationDelivery`, DPAPI, polling e confirmação; nenhum aviso real enviado ou marcado nesta auditoria |
| Serviço | `CepHoras.Control/Program.cs`, controle/estado durável, IPC, políticas e supervisão |
| Atualizações | Projetos `CepHoras.Updates`, `MainWindow.MsiUpdates` e canal legado MSIX com consumidor real em `MainWindow` |
| Instalador | WiX `.wxs/.wixproj`, scripts MSI/MSIX, manifesto de pacote, arquivos de instrução; entrypoints não dependem de imports React |
| Assets | Os dois PNG são referenciados; fontes Manrope são importadas no entrypoint. Nenhum asset comprovadamente morto |
| Estilos | CSS de autenticação, administração, avisos, jornada, energia, download e prévia; classes `badge-*` e `overview-*` são montadas dinamicamente |
| Testes | Vitest em `src`; Playwright em `tests/browser`, fixtures em `tests/fixtures`; driver WPF e projetos .NET separados |
| Build/deploy | `package.json`, Vite/TypeScript/ESLint, Docker/Nginx/Compose, `deploy/`, workflows; não alterar como se fossem código importado pelo navegador |

## Limpeza realizada e seleção de commits

| Commit | Alteração |
|---|---|
| `4a8b694` | Remove classe sem uso `user-source-status`, metadados não consumidos `desktopRelease.url/checksum`; torna internas oito declarações antes exportadas sem consumidor externo |
| `1bb47bf` | Reconciliado teste de download com título/card atuais; retiradas expectativas dos requisitos/FAQ antigos |
| `82e48e6` | Fixture de jornada movida de `src/user` para `tests/fixtures`, com três imports atualizados; mesmos dados sintéticos |
| `0bc1391` | Retira guarda `!embedded` redundante após retorno antecipado do modo embedded, sem mudar renderização |
| `fa57758` | Corrige descrição de fallback autenticado que alegava inexistência da área de membro/líder já implementada |
| `ee1ad21` | Teste de reprocessamento seleciona status dentro de `main`, sem ambiguidade com contador de avisos no cabeçalho |

Declarações tornadas internas: `AuditEvent`, `dailyDifference`, `zone`, `QueryValues`, `ApiProblem`, `desktopRelease`, `Notification`, `Report`. Seus usos internos continuam existentes. Tipos de bridge/energia e contratos gerados foram preservados.

## Candidatos conservados / próximos trabalhos

| Candidato | Por que não foi removido |
|---|---|
| `SystemAdminShell` e role técnico | Possui navegação e operações reais. Retirada precisa alinhar regra aprovada, backend, contas/provisionamento e upgrade, não apenas esconder UI |
| Canal MSIX e scripts ZIP/perfil | Chamados pelo host ou são entrypoints de distribuição documentados. Requer decisão de suporte/migração para MSI antes de retirar |
| Página download / release antiga | Continua oferecendo ZIP 0.2.0.1; mudar destino exige pacote/publicação homologados, não limpeza estrutural |
| Jornada / análises | Sobreposição visual não implica mesma semântica; redesenho não autorizado nesta limpeza |
| Documentos de pilotos/refatorações | Evidências históricas ainda úteis e identificadas por data/base; nenhuma instrução corrente depende de segredo. Índice atualizado para esta auditoria; links locais existentes conferidos |
| Snapshots OpenAPI | Artefatos de referência e consumo distintos, mesmo quando conteúdo coincide; não consolidar sem alterar processo de compatibilidade |
| Prévia DEV | Uso explícito para revisão visual e testes; produção a exclui pelo gate Vite |
| Dependências de desenvolvimento | CLI/manual/CI são consumidores possíveis; nenhuma exclusão apoiada apenas em ausência de import React |
| CSS / helpers comuns | Resíduos comprovados retirados; classes dinâmicas, funções internas e APIs de biblioteca preservadas |

## Verificação e limites

Lint, 100 testes unitários e build TypeScript/Vite aprovados no estado final. A primeira execução de navegador encontrou quatro falhas no seletor genérico `role=status` do histórico após inclusão do sino, com 216 aprovações; seletor foi corrigido e a suíte repetida no estado final. O resultado final e os limites de publicação ficam no relatório de entrega.

Testes usam fixtures isoladas; não homologam fontes reais, SMTP, ações Windows, instalação/upgrade MSI ou API em produção. Nenhum arquivo C#/XAML/WiX/protocolo nativo foi alterado, portanto não foi necessário repetir instalação ou testes nativos para esta limpeza. Não houve merge, push, deploy, recriação de contêiner, release ou integração da linha desktop mock.
