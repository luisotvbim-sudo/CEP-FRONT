# Compatibilidade CEP-FRONT × CEP-API

Alteração de senha em 05/10/2026: ativação e recuperação permitem de 6 a 200 caracteres. Publicar primeiro a API com RequiredLength=6 e contratos atualizados; depois web/cliente Windows. Não muda rotas, payloads, tipos nem allowlist. Snapshots foram regenerados da API local da entrega: o gerador atual não publica limites de senha nos schemas desses records. Homologação com PostgreSQL e versão instalada permanece necessária.

Revisão documental de 04/10/2026. Front auditado: `main` `eb63dbdc7f7bf83d0a4b51ee5567ed5aa80c138c`. API de referência: `main` `b36c6e149b42253b44860d98c6ffe44f98c53dd6`. Código publicado, CI aprovada e SHA implantado não são o mesmo estado.

## Contrato disponível e consumido

[OpenAPI real](openapi-backend-current.json) e [OpenAPI consumido](openapi.json) incluem o contrato aditivo de acompanhamento pessoal, gerado na API da branch `codex/acompanhamento-usuario` em 05/10/2026 sobre `e13b804a288220e636c23acf8b792a9799b69157`. Os três snapshots são idênticos nesta entrega; tipos em `src/auth/api-schema.d.ts`. A base auditada anterior tinha 52 paths/72 schemas. Esta branch exige a nova API para o resumo; 404 mantém acesso ao histórico/avisos e não é transporte offline.

| Recurso | Estado implementado |
|---|---|
| Sessão web | Login/refresh/logout em `/auth/web/...`, cookie protegido de mesma origem |
| Sessão desktop | Tokens no host DPAPI; bridge/allowlist com operações explícitas |
| Ativação de convite | `/auth/invitations/activate`, 204 sem sessão; formulário público web/nativo |
| Pessoas/associação/convites | IDs Monday/VR, fila de e-mail, reenvio administrativo; enfileirar não prova entrega |
| Times/usuários/auditoria | Telas administrativas; Líder/Membro recebem consultas autorizadas |
| Sincronização/histórico | Normal 7 dias, full administrativo até 90; registros e resumos diários calculados na API |
| Análises/notificações | Configurações/agendas globais, prévia/envio, caixa pessoal, leitura/recebimento, histórico e snapshots de análise |
| Acompanhamento pessoal | GET autenticado próprio, períodos oficiais, situação, corte e valores/limites das fontes; [contrato do consumidor](acompanhamento-pessoal.md) |
| Energia | Decisão pessoal, verificação/status e liberação PIN temporária; execução local requer MSI corporativo compatível |

GET de análises consulta resultados persistidos, sem nova importação. Histórico armazenado não certifica completude/atualidade das fontes. O cliente apresenta `null`, qualidade, períodos e cortes retornados; não recalcula saldo, tolerância, destinatários ou autorização.

## Escopo e dependências pendentes

Coordenador opera sua organização. Líder recebe a união dos times ativos com vínculo vigente hoje; Membro recebe sua pessoa se elegível. Usuário sem vínculo ativo pode receber vazio. `SystemAdmin` seleciona `organizationId` para rotas organizacionais; configurações globais e central pessoal não herdam essa seleção. Não atribuir registros históricos automaticamente a um time antigo.

Workflow de casos, justificativas/aprovações, calendário/jornada/exceções, ranking completo e exportações de planilha/PDF não estão no contrato atual. Conservar os requisitos planejados na [especificação](produto/especificacao-funcional.md), sem inventar DTOs/rotas ou números de produção.

Há evidência histórica de implantação anterior, mas o SHA atual da API/front, migrations, fontes/SMTP e automação ativa na VM não foram confirmados nesta revisão. Health/Swagger comprovam somente seu próprio resultado. Fontes reais, entrega de e-mail, perfis autorizados e MSI exigem homologação própria.

## Atualização segura

1. Identificar branch/SHA da API efetivamente executada; não substituir o contrato de referência por Swagger de processo antigo.
2. Em Development, atualizar snapshot real:

   ```powershell
   ./scripts/sync-openapi.ps1 -OutputPath ./docs/openapi-backend-current.json
   ```

3. Comparar paths/métodos, parâmetros, respostas, enums e schemas. Adaptar o contrato consumido e executar `pnpm types:api` junto com cliente, allowlist e testes correspondentes.
4. Registrar dependência que o backend ainda não entrega. Não ampliar permissão no renderer nem abrir prefixo genérico no host.
5. Implantar API/migration compatíveis antes de cliente que dependa delas; preservar sessão, proxy e chaves Data Protection.

Referências: [contexto atual](CONTEXTO-ATUAL.md), [análises/notificações](contrato-analises-notificacoes.md), [histórico](historico-diario.md), [ativação](contrato-ativacao-convite.md), [reenvio](contrato-reenvio-convite.md), [energia](menu-energia.md) e [deploy](../deploy/README.md).
