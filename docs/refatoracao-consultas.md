# Refatoração das consultas por chave e escopo

Registro da implementação de 04/10/2026, vinculada à [Issue central #14](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/14), à oportunidade de consulta por chave e ao consumo de intenção da Inbox (R15) do mandato `REFATORACAO-INSTALADOR.md`. Base: `1911a317dda45e10cd2302af97e8bdfe9a385a61`, branch `codex/installer-reliability`. Este escopo modifica os hooks, os dois consumidores de notificações e seus testes de navegador; não altera rotas, schemas, autorização, shells ou transporte compartilhado.

## Achado e comportamento entregue

Na base, cada execução de `useQuery` removia `data`, inclusive o polling da mesma consulta. Inbox e histórico de envios usavam `pending` para substituir as listas por loading. Isso desmontava os detalhes abertos e perdia o foco do teclado na Inbox a cada ciclo. A implementação mantém o último resultado bem-sucedido somente enquanto a chave continua igual, também quando a atualização falha, e exibe erro com opção de tentar novamente.

O estado passa a carregar uma cópia das chaves da requisição. A comparação usa comprimento e `Object.is` em cada posição. Uma troca de chave oculta imediatamente dados e erro anteriores no próprio render, antes da limpeza dos efeitos. Respostas de requisições encerradas continuam descartadas pelo sinal de atividade do efeito. Não há cache de múltiplas chaves nem persistência de dados: ao trocar de filtro, organização ou conta, o resultado anterior não é reaproveitado.

`pending` conserva seu significado de requisição em andamento para os consumidores existentes. Os novos indicadores `initialLoading` e `refreshing` permitem distinguir ausência de resultado e atualização da mesma consulta. Inbox e histórico de envios preservam a lista durante `refreshing`, com mensagem de atualização e `aria-busy`; outras telas continuam usando seus estados atuais. O formulário de envio, a confirmação, a prévia e a chave idempotente de escrita conservam seu fluxo.

As chaves explícitas continuam sendo o contrato do hook: cada consumidor deve incluir os valores que mudam o escopo da leitura. Os consumidores auditados incluem cliente/filtro/página e organização conforme a consulta; a aplicação desmonta o shell na saída da conta e remonta o contexto administrativo na troca de organização. A correção não tenta inferir identidade a partir do conteúdo de respostas nem substitui a autorização da CEP API.

A revisão final também encontrou confirmação precoce da intenção nativa: `useOpenInbox` enviava `cep-inbox-consumed` logo após solicitar a troca de página, antes de a Inbox montar. Agora o hook apenas solicita navegação; a Inbox confirma no efeito posterior ao commit, incluindo `documentId`. Um listener no destino confirma novas intenções quando ele já está aberto. Ausência/falha da bridge conserva a intenção para outra entrega. O host é responsável por conferir documento/readiness antes de apagar sua própria intenção.

## Validação executada

Ambiente: Windows `10.0.26200.0`, Node `24.19.0`, Chromium instalado localmente ao worktree, Vite na porta `5188`. Os testes usam fixtures compatíveis com o snapshot da API; não houve validação de dados reais ou dependência de PostgreSQL.

```powershell
$env:CEP_TEST_PORT = '5188'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.local/ms-playwright'
pnpm exec playwright test tests/browser/notifications.spec.ts tests/browser/refactor-regressions.spec.ts --workers=2 --output=.local/query-browser-results
pnpm exec tsc --noEmit
pnpm exec eslint src/hooks/async.ts src/notifications/Inbox.tsx src/notifications/SendNotification.tsx tests/browser/notifications.spec.ts
```

Os 28 testes passaram nos projetos desktop e mobile: nove cenários de notificações e cinco regressões existentes por projeto. Os seis casos novos verificam:

- polling da Inbox com requisição pendente e falha 503, conservando análise expandida, valores indisponíveis e foco no resumo;
- troca de filtro durante polling, ocultando o resultado anterior e recusando sua resposta tardia;
- polling de envios, conservando histórico, foco e rascunho enquanto o status muda de pendente para concluído;
- troca de organização durante polling, sem recuperar histórico ou rascunho do contexto anterior;
- logout e entrada de outra conta enquanto a requisição anterior ainda está pendente, sem exibir seus avisos;
- confirmação nativa somente com o título do destino já presente no DOM, nova intenção na Inbox aberta e conservação da intenção quando o envio pela bridge falha.

TypeScript, ESLint dos arquivos alterados e `git diff --check` do escopo passaram. A formatação foi aplicada apenas aos arquivos desta frente.

Para comprovar os defeitos, uma cópia descartável em `.local/query-baseline` usou somente `async.ts`, `Inbox.tsx` e `SendNotification.tsx` do SHA base. Os dois novos casos de polling falharam: o resumo focado da análise e o item do histórico desapareciam durante a atualização. A execução usou Vite separado na porta `5190`; os fontes da branch de trabalho não foram revertidos.

Essa cópia também conservava o hook de intenção anterior à correção final de R15. O novo teste de confirmação falhou exatamente com `inboxCommitted: false` e ausência de `documentId`: o post havia ocorrido antes de existir o título da Inbox. O código de trabalho passou nos dois projetos.

## Limites

Os testes de conta e organização verificam as fronteiras de desmontagem já existentes na aplicação. Não foi criado mecanismo de cache entre contas, alteração de permissões ou replay de escrita. Preservar o último resultado em erro deixa dados anteriores visíveis com a falha da atualização; o usuário pode repetir a leitura. A retomada real após recuperação do host WPF é validada na frente de lifecycle desktop, sem ser declarada por estes testes de navegador.
