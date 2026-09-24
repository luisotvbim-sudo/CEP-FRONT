# Plano de trabalho do CEP-FRONT — CEP Horas

Atualizado em 23/09/2026. Este arquivo orienta a próxima implementação no `CEP-FRONT`; **não** declara que as tarefas abaixo já foram executadas. O objetivo imediato é entregar as telas que a API atual sustenta e registrar, sem simulação em produção, as telas que dependem de novos contratos do backend.

## Fontes de verdade e limites

1. Antes de alterar código, seguir [`../AGENTS.md`](../AGENTS.md), ler [`produto/especificacao-funcional.md`](produto/especificacao-funcional.md), [`compatibilidade-backend.md`](compatibilidade-backend.md), [`../README.md`](../README.md) e os snapshots [`openapi-backend-current.json`](openapi-backend-current.json) / [`openapi.json`](openapi.json).
2. O roteiro detalhado de telas, permissões e contratos está no repositório irmão `CEP-API/docs/guia-telas-frontend-cep-horas.md`. Conferir o OpenAPI efetivo da branch da API antes de implementar. Se a API local estiver ativa, atualizar primeiro o snapshot real pelo script `scripts/sync-openapi.ps1`; Swagger acessível não substitui PostgreSQL e fontes configuradas.
3. No backend atual, `role=user` corresponde a Membro ou Líder conforme vínculos de time vigentes. `organizationAdmin` é Coordenador. `systemAdmin` só opera uma organização depois de selecioná-la. O servidor, não o React, decide a autorização.
4. A atualização normal reavalia os **últimos 7 dias** do escopo solicitado. A carga inicial administrativa e `full=true` abrangem **até 90 dias**. A persistência é idempotente, mas a consulta externa não é um delta puro por alteração desde o último cursor. O histórico aceita até **90 dias inclusivos por requisição**.
5. O histórico disponível é **bruto**. Não existem endpoints de saldo oficial, conciliação diária, cobertura por pessoa/dia, divergências, justificativas, alertas, notificações ou relatórios conciliados. Não calcular esses resultados no cliente e apresentá-los como validados.

## Fase 0 — compatibilidade do front existente

- Corrigir todas as referências a 60 dias para o contrato atual de 90 dias: `src/admin/HistoryPage.tsx`, `src/admin/SyncPage.tsx`, `src/admin/format.ts`, mensagens em `src/auth/auth-client.ts`, testes, README e documentos de produto/compatibilidade.
- Diferenciar na UI `Atualizar últimos 7 dias` de `Reprocessar até 90 dias e diretórios`; `full=true` fica visível só para administração. Não chamar a atualização normal de “delta puro”.
- Corrigir o texto de `src/admin/TeamsPage.tsx` que afirma que o vínculo de Líder ainda não concede acesso operacional: o backend já filtra pessoas, times e histórico, embora as telas de gestão não existam.
- Na sincronização, `completeSnapshot` de tentativa normal vale para o escopo processado; `receivedCount=0` pode significar que o diretório não foi consultado. Última tentativa não é automaticamente último sucesso. Mostrar sucesso/falha por fonte.
- Tratar `sync_scope_empty`, `sync_already_running`, `full_sync_forbidden` e erros de coluna/responsável do Monday por código, com ação orientada. Para Membro/Líder, `latest` mostra apenas lotes solicitados por eles; após conflito causado por outro usuário, não fazer polling de lote desconhecido.
- Se rotas ou schemas mudarem, alinhar os dois snapshots OpenAPI e os tipos gerados antes de adaptar o cliente; não fazer isso apenas por mudança de texto/regra sem alteração do contrato.

## Fase 1 — telas operacionais possíveis com a API atual

| Tela | Dados e ações | Critério de pronto |
|---|---|---|
| Minha jornada | Novo shell para `role=user`, cabeçalho de sessão, período, estado das fontes e botão de atualização normal. | Não mostra navegação administrativa; não promete saldo conciliado. |
| Meu histórico | `GET /organization/time-control/people` e `/history` com período/fonte; pessoa ligada ao usuário autenticado. | Data civil de São Paulo; `null`, `missing`, `unrecognized` e `running` não viram 0h. |
| Detalhe do dia bruto | Registros Monday e VR Mais, duração, estado, horário, título, batidas quando presentes e link HTTPS de origem. | Informação de origem rastreável; nenhum diagnóstico trabalhista inferido. |
| Gestão dos times do Líder | `GET /teams` para times geridos; `GET /teams/{id}/assignments` para vínculos; `/people` para associação por `userId`. | Líder de A/B não vê C; Membro não recebe uma lista falsa de “meus times”. |
| Histórico de pessoa do time | `/history?workforcePersonId=...` com filtro; seleção só entre pessoas visíveis. | Perda de vínculo limpa seleção/cache; servidor continua barrando ID fora do escopo. |
| Atualização do escopo | `POST /synchronizations` e estado por fonte; invalidar o histórico ao concluir. | Membro atualiza a si; Líder atualiza a si e pessoas dos times liderados; botão não promete atualizar só o time selecionado. |

Observações de implementação:

- A visão pessoal continua disponível quando o usuário também é Líder. `GET /teams` lista **times geridos**, não o time de que um Membro participa. Um `user` sem vínculo ativo pode receber `/people` e `/history` vazios mesmo tendo identidade associada; exibir estado explicativo e registrar a necessidade de ajuste/validação no backend, não “zero horas”.
- Usar os vínculos **vigentes hoje** para a lista e autorização atuais. Não atribuir horas históricas automaticamente ao time em que a pessoa estava na data do registro: o contrato ainda não fornece essa divisão.
- O Monday atribui a sessão ao responsável único do item/subitem, não ao usuário que clicou no cronômetro. Não ligar pessoas por nome/e-mail quando `userId` e IDs internos estiverem disponíveis.
- Consultar períodos de até 90 dias não significa que o botão de atualização normal recarregue 90 dias; ele sempre reavalia hoje e os seis dias anteriores. Valores antigos podem estar persistidos, mas não ter sido atualizados nessa tentativa.

## Fase 2 — completar administração com os endpoints existentes

- Preservar Pessoas, Correspondências, Convites, Times e Sincronização atuais; revisar estados vazios, conflito de associação, convite enfileirado (não entregue), fonte parcial e histórico de 90 dias.
- Criar área de **Usuários e coordenadores** com `GET/PATCH /organization/users` e convites administrativos. Preservar `role`, `status` e `products` não editados ao enviar PATCH. Tratar `last_organization_admin`. Alterações de papel/status revogam sessões.
- Criar tela de **Auditoria** com `GET /organization/audit?before=&pageSize=`; é auditoria administrativa, não histórico de justificativas ainda inexistentes.
- `systemAdmin` deve selecionar explicitamente a organização e enviar `organizationId` nas rotas organizacionais. Não interpretar esse perfil técnico como participante comum do time.
- **Desktop:** a allowlist em `desktop/CepHoras.Desktop/ApiSession.cs` ainda não permite auditoria nem `PATCH /organization/users/{id}`. Adicionar somente as rotas necessárias, depois de revisar método, path, parâmetros, autorização e testes do bridge. Não abrir um prefixo genérico.

### Aceite de convite: dependência de segurança antes da tela web

O backend hoje oferece `POST /api/v1/auth/invitations/accept`, que retorna `TokenResponse` **com refresh token no corpo**. Já o navegador do `CEP-FRONT` usa `/auth/web/login` e `/auth/web/refresh` para manter esse token apenas em cookie `HttpOnly`. Portanto, **não ligar diretamente o formulário web de aceite ao endpoint atual e guardar ou repassar o refresh token ao React**.

Antes de considerar a tela web pronta, alinhar com o backend um fluxo de aceite próprio para navegador (por exemplo, resposta com sessão/cookie protegido, ou aceite sem sessão seguido de login web). Só então adaptar `AuthClient`, criar formulário de e-mail/código/nome/senha e testar expiração, código inválido e múltiplas abas. O bridge desktop também não permite essa rota atualmente; decidir se o convite será aceito no navegador ou se haverá um método nativo específico, sem expor tokens à WebView.

## Fase 3 — telas desejadas, condicionadas a novos contratos

| Funcionalidade | O que a interface deverá oferecer quando a API existir | Dependência do backend |
|---|---|---|
| Painel do Membro | Totais VR/Monday, saldo assinado, divergência absoluta, cobertura, calendário e detalhe diário. | Conciliação por pessoa/período com qualidade, regras e referências. |
| Painel do Líder | Filtro de time/período, diferenças por membro, ranking sem compensar `+` e `−`, detalhe. | Resumo por time/pessoa com escopo no servidor. |
| Painel do Coordenador | Organização toda, diferenças por pessoa e equipe, qualidade por fonte. | Resumos organizacionais e atribuição de pessoas em múltiplos times/transferências. |
| Divergências e justificativas | Solicitar correção, responder, avaliar, devolver, encerrar/reabrir com histórico. | API de casos e transições, autoria, concorrência e autorização. |
| Alertas e notificações | Caixa individual, leitura, contexto e próximo passo. | API de notificações; leitura não resolve caso. |
| Relatórios/exportação | Prévia e planilha conforme o mesmo filtro e escopo da tela. | API de relatório/exportação baseada na conciliação oficial. |
| Regras e calendário | Tolerâncias, feriados, ausências e atividades elegíveis com vigência. | API administrativa e decisões funcionais aprovadas. |

Essas telas podem ter desenho ou componentes preparatórios, mas não devem mostrar números fictícios em produção nem chamar endpoints inexistentes. Quando a conciliação existir, **todos** os indicadores de pessoa, time e organização obedecem ao mesmo intervalo inclusivo aplicado pelo usuário; selecionar cinco dias deve produzir saldo e demais métricas somente desses cinco dias. Fonte indisponível não equivale a zero; dia atual é provisório; justificativa aceita não apaga a diferença original.

## Validação e entrega

1. Testar escopos com Membro, Líder de dois times, Coordenador e `SystemAdmin`; incluir tentativa de consultar pessoa/time de fora do escopo e perda de vínculo durante a sessão.
2. Testar 7/90 dias, intervalo de 90 dias inclusivos versus 91, fonte parcial, atualização concorrente, pessoa sem associação/vínculo, `durationSeconds=null` e duração maior que 24h.
3. Testar login/refresh/logout web e desktop sem expor refresh token ao React. Para novas rotas do bridge, testar allowlist positiva/negativa. Para aceite de convite, aguardar o contrato web seguro.
4. Rodar `pnpm lint`, `pnpm test`, `pnpm build`, Playwright e testes desktop pertinentes. Se API/PostgreSQL/fontes não estiverem disponíveis, registrar que o fluxo foi validado apenas por contrato/mocks; não alegar homologação real.
5. O deploy permanece separado entre API e front; mudança de publicação exige verificação específica de compatibilidade, CI, Compose, proxy e health check. Commit e integração na `main` foram autorizados posteriormente pelo solicitante; esta autorização não inclui alterar a CEP-API nem executar o deploy.

O plano pode ser executado por fases. Ao concluir cada uma, atualizar o estado deste arquivo e os documentos de compatibilidade, distinguindo claramente **feito**, **bloqueado pelo backend** e **ainda não iniciado**.

## Estado desta execução (24/09/2026)

- **Feito localmente:** correções de 7/90 dias e textos de sincronização; navegação e histórico bruto de Membro/Líder; consulta de times geridos; atualização normal; gestão de usuários e convites administrativos; auditoria; allowlist desktop específica; atualização do snapshot OpenAPI real e correção do status documentado do logout web. Build, lint, testes unitários e 76 testes de navegador passaram.
- **Validado somente com mocks:** telas e fluxos de navegador. A API local respondeu no Swagger e em `/health/ready`, mas nenhum login de homologação foi fornecido para provar os escopos e dados reais.
- **Validado com fixture desktop:** após restaurar a dependência WebView2, o build .NET e o teste real WPF/WebView2 passaram com servidor HTTP descartável, incluindo rotas positivas/negativas da allowlist, sessão, rotação e logout. Ainda falta homologação autenticada com a API real.
- **Bloqueado pelo backend:** aceite seguro de convite no navegador e todas as telas de conciliação, saldo, divergências, justificativas, notificações, regras/calendário e relatórios oficiais.
- **Preparação de produção:** o Vite local foi parado. A imagem Docker compilou e passou no smoke test em loopback: `/healthz` 200, SPA 200 com CSP e `/api/v1/me` 404 no Nginx interno, em execução read-only, sem capacidades e sem privilégios adicionais. O contêiner de teste foi encerrado. Compose e sintaxe dos scripts Bash validados; arquivos `.env` e testes foram excluídos do contexto Docker. Lint, 18 testes unitários e build passaram. Na nova rodada de Playwright, 76 testes passaram, mas o runner Windows excedeu o timeout de 120 segundos ao finalizar o servidor de testes; a CI Linux deve confirmar o encerramento sem erro.
- **Pendente com o agente de deploy:** configurar `cep.lat` e `/api/` no Nginx de borda da CEP-API, com DNS/certificado HTTPS; executar homologação autenticada com contas autorizadas. O checkout local da CEP-API ainda não publica `cep.lat`.
- **Não executado aqui:** deploy, publicação, homologação autenticada e desligamento do computador. A integração na `main` é tratada separadamente nesta execução.
