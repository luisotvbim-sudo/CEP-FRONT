# Refatoração do CEP-FRONT — 29/09/2026

Base: `main` em `7237178`. Branch de entrega: `codex/refatoracao`.

## Objetivo e limites

Simplificar responsabilidades compartilhadas, reduzir repetição e proteger os fluxos existentes com testes de comportamento. A revisão abrange React, clientes da CEP API, autenticação web, bridge WebView2, sessão e armazenamento Windows, histórico, administração e notificações. O backend é outro repositório e não foi alterado nesta entrega.

As regras de autorização, os totais diários e a diferença Monday/VR continuam sendo responsabilidade da API. Não houve alteração de endpoints, contrato, permissões, paleta ou fluxo de associação e convite.

## Organização resultante

| Responsabilidade | Local | Decisão |
| --- | --- | --- |
| Consultas e ações assíncronas | `src/hooks/async.ts` | Uma implementação para carregamento, erro, descarte de respostas obsoletas e bloqueio de submissão simultânea. Componentes visuais não definem essas regras. |
| Parâmetros, escopo e paginação | `src/api/query.ts` | Serialização comum, organização explícita somente em rotas organizacionais e leitura completa em lotes de até quatro páginas simultâneas. |
| Erros | `src/auth/errors.ts` | Uma tradução de `ProblemDetails` para web e bridge, preservando `correlationId` sem mostrar detalhes internos do servidor. |
| Histórico | `src/admin/useHistory.ts`, `history-data.ts`, `DailyHistory.tsx` | Consulta compartilhada por administração e membro/líder; agrupamento separado da apresentação; totais recebidos da API. |
| Notificações | `src/notifications/` | Configuração/agendas, envio, caixa de entrada, análises e detalhes em módulos próprios. `index.ts` mantém a entrada do recurso. |
| Formulários públicos | `src/components/` | Login, recuperação e ativação usam a mesma proteção contra submissão duplicada; abertura e fechamento de modal têm um hook comum. |
| Rotas nativas permitidas | `desktop/CepHoras.Desktop/ApiRoutePolicy.cs` | Política isolada, testável e aplicada no host; não depende do React. |
| Persistência protegida | `desktop/CepHoras.Desktop/ProtectedJsonFile.cs` | DPAPI compartilhado entre sessão e recibos, mantendo formato e entropia compatíveis com arquivos anteriores. |

`AuthClient` continua sendo a fronteira entre interface e transporte. Web Locks/cookie HttpOnly e gate/DPAPI nativos permanecem implementações distintas porque seus mecanismos de segurança são diferentes. Não foram introduzidos um contêiner de injeção, dependências novas ou uma hierarquia genérica de serviços.

## Correções e redução de trabalho desnecessário

- `restore()` do navegador compartilhava também um resultado já concluído. Agora compartilha apenas a operação em andamento, evitando devolver uma sessão anterior depois de logout.
- `reload` tinha identidade nova a cada renderização. O polling de envios reiniciava ao editar o formulário; o callback agora é estável.
- Consultas capturam seu carregador e descartam respostas após invalidação. Efeitos cancelados antes de começar não fazem uma chamada extra no Strict Mode.
- Administração de organizações usa os hooks comuns, inclusive bloqueio síncrono contra duas submissões no mesmo ciclo.
- O histórico invalida respostas atrasadas ao sair do contexto. Uma submissão duplicada ignorada não invalida o resultado da primeira consulta.
- Agrupamento diário percorre registros uma vez e usa mapas, em vez de filtrar todos os registros para cada dia. Detalhes só são montados quando a linha é expandida.
- Diretórios paginados mantêm ordem e limite de concorrência. Falha em uma página falha a consulta inteira: uma lista incompleta não é apresentada como conjunto completo de destinatários.
- Erros com payload malformado ou `code` igual a nomes herdados de `Object` são tratados de forma segura.

Não há benchmark de produção nesta entrega. As melhorias de custo acima decorrem da redução de varreduras, montagem de elementos e concorrência sem limite; não representam uma promessa de ganho percentual.

## Testes acrescentados

| Camada | Novas verificações |
| --- | --- |
| Consultas | Codificação de caracteres, `false`/zero, organização sem duplicação, proibição de escopo em rotas globais, ordenação e falha de paginação. |
| Histórico | Agrupamento, registros sem data, imutabilidade, totais autoritativos, duração indisponível e ausência de dados. |
| Autenticação web | Restauração após logout, resposta atrasada depois de sair, limite de uma recuperação após 401. |
| Bridge TypeScript | Respostas fora de ordem, mensagens alheias, limpeza de listeners, timeout sem replay, restauração concorrente e preservação de senha. |
| Navegador | Polling durante edição, busca antiga com erro, saída de histórico de outro membro, criação duplicada de organização e consulta duplicada de histórico, em desktop e celular. |
| Windows | Rotas e métodos permitidos/negados, roundtrip DPAPI, compatibilidade anterior, entropia, corrupção, recibos, renovação concorrente, resposta perdida sem replay, logout com erro e repetição limitada após 401. |

Os testes que contam chamadas HTTP agora distinguem `/api/` da API de `/src/api/` do servidor Vite; carregar um módulo do frontend não conta como integração com backend.

## Validação

- TypeScript e ESLint sem erros.
- 50 testes unitários TypeScript aprovados.
- 124 testes Playwright aprovados, nos projetos desktop e celular.
- 152 verificações de sessão, rotas e armazenamento Windows aprovadas.
- 16 verificações existentes do atualizador aprovadas.
- Build web de produção e builds Windows Debug/Release.
- Teste existente de WPF/WebView2 real com API descartável: rotação única, reinício/restauração, DPAPI, isolamento de tokens, bloqueio de rotas, popup e logout.

Comandos de reprodução:

```powershell
pnpm lint
pnpm test
pnpm build
$env:CEP_TEST_PORT='5184'
pnpm test:e2e
dotnet run --project desktop/CepHoras.Desktop.Tests -c Release
dotnet run --project desktop/CepHoras.Updates.Tests -c Release
dotnet build desktop/CepHoras.Desktop -c Debug
node scripts/test-desktop.mjs
dotnet build desktop/CepHoras.Desktop -c Release
```

A porta separada impede testar acidentalmente outro checkout aberto em 5173. O novo projeto de testes nativos também faz parte do job Windows do CI.

## Evidência de contrato e pendências

A sincronização solicitada foi executada contra `127.0.0.1:8080`. O processo local expôs um contrato antigo, com 39 caminhos, anterior às análises/notificações e aos totais diários já versionados na base desta branch. Esse resultado não foi usado para regredir os snapshots compartilhados: `docs/openapi.json`, `docs/openapi-backend-current.json` e `src/auth/api-schema.d.ts` mantêm o contrato de referência da `main`.

Os testes utilizam fixtures identificadas e descartáveis; não comprovam integração autenticada com a versão publicada, entrega real de e-mail nem importação real de Monday/VR. Homologar esses fluxos exige uma API com o contrato de referência e contas/dados autorizados. Esta refatoração não requer endpoints novos.

A separação dos contêineres de produção, o proxy, scripts de implantação e empacotamento MSIX foram preservados. Não houve deploy ou instalação de uma versão distribuível. A prévia visual em `src/preview/` continua isolada dos dados reais. A suíte não significa cobertura de 100% nem elimina a necessidade de homologação externa.
