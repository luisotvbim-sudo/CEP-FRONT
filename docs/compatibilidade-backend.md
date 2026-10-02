# Compatibilidade entre CEP-FRONT e CEP-API

> Menu de energia: [interface, contrato e integração WPF](menu-energia.md). Em 01/10/2026, snapshots e tipos alinhados à API local na `main` `b36c6e1`, com POST de liberação por PIN, POST de verificação e GET de status. O PIN libera apenas a conta autenticada por cinco minutos de servidor, sem dispensar a revalidação nativa. Produção depende da migração e do provisionamento seguro no backend, sem deploy de backend nesta entrega. Execução, cancelamento e contingência estão implementados no bridge e no serviço do MSI corporativo; navegador, Debug e builds portáteis continuam sem ações locais.

> Histórico diário de 29/09/2026: [contrato, telas e limites](historico-diario.md). O backend adiciona `days` por pessoa; os snapshots e tipos estão alinhados. Implantar o backend correspondente antes do frontend.

> Entrega de 29/09/2026: [análises e notificações implementadas](notificacoes-implementacao.md), com contrato real nos dois snapshots OpenAPI e tipos regenerados. Configurações/agendas são globais; envios e análises respeitam o escopo da API. Tolerância inicial: 30 minutos nos dois sentidos. Implantar primeiro o backend correspondente. O retrato de 23/09 abaixo é histórico e não descreve as novas capacidades.

Atualizado em 23/09/2026.

Referências desta revisão:

- frontend: `CEP-FRONT/main`, incluindo as alterações locais de documentação e terminologia;
- backend: `CEP-API/codex/integracao-monday-vrmais`, incluindo login web e permissionamento local validados por testes;
- contrato real do backend: [`openapi-backend-current.json`](openapi-backend-current.json);
- contrato usado para gerar os tipos do front: [`openapi.json`](openapi.json).

## Estado atual

O snapshot real foi sincronizado com o Swagger local em 23/09/2026; `/health/ready` respondeu `200`. Os contratos estão alinhados em rotas e schemas: ambos possuem 39 caminhos, incluindo `/api/v1/auth/web/login`, `/refresh` e `/logout`, e 48 schemas. O status documentado de `/auth/web/logout` no contrato do cliente foi corrigido para `200`. O backend também expõe `organizationId` nas 22 operações esperadas pelo cliente. Isso não equivale a homologação autenticada com dados reais.

As seguintes dependências anteriores foram fechadas:

1. sessão web com refresh token protegido em cookie `HttpOnly`, `Secure`, `SameSite=Strict` e prefixo `__Host-`;
2. atuação de `SystemAdmin` em uma organização escolhida explicitamente;
3. consulta de Líder limitada aos times com vínculo `Manager` vigente;
4. consulta de Membro limitada à própria associação e aos próprios registros.

O `SystemAdmin` continua sendo administração técnica. `organizationId` é obrigatório quando ele usa rotas de uma organização. Para Coordenador, Líder e Membro, a organização do token continua soberana e uma tentativa de substituí-la é rejeitada.

## Limite entre backend e interface

- Em 29/09 foi criada uma [prévia isolada das sete telas de análises e notificações](previa-analises-notificacoes.md), somente em desenvolvimento. Ela não chama endpoints nem comprova homologação. Durante esta etapa, outro trabalho atualizou contratos e integração no mesmo checkout; a validação dessa integração é distinta da revisão visual.

- A área administrativa de Coordenador e `SystemAdmin` possui interface no front, incluindo usuários e auditoria.
- O transporte web agora possui contrato correspondente no backend, mas a publicação em produção ainda exige proxy HTTPS de mesma origem e persistência das chaves Data Protection.
- O backend já aplica o escopo de Líder e Membro nas consultas atuais de times, pessoas e histórico.
- As telas operacionais de Líder e Membro agora oferecem histórico bruto, times geridos e atualização normal. A navegação administrativa não é apresentada a esses perfis. Os fluxos novos foram testados com mocks; acesso real com contas de cada papel ainda não foi homologado.
- O aceite de convite no navegador permanece bloqueado: `/auth/invitations/accept` devolve refresh token no corpo, enquanto a sessão web exige cookie `HttpOnly`. É necessário contrato web seguro no backend antes de criar essa tela.
- Conciliação, divergências, justificativas, alertas, notificações e relatórios formatados continuam fora do contrato atual.

## Regras para novas alterações

1. Usar `openapi-backend-current.json` como evidência do contrato realmente exposto.
2. Manter `openapi.json` e os tipos gerados sincronizados quando rotas ou schemas mudarem.
3. Não substituir o isolamento do servidor por filtros no React.
4. A nomenclatura de produto é Coordenador, Líder, Membro, Organização e Time. Os nomes técnicos permanecem `OrganizationAdmin`, `Manager`, `Member`, `UserRole` e `TeamAssignmentRole` no contrato.
5. Novas telas de Líder/Membro devem consumir somente as respostas já filtradas pelo backend e testar tentativas de acesso fora do escopo.

## Atualização do snapshot

Com a API local em execução no modo `Development`:

```powershell
.\scripts\sync-openapi.ps1 -OutputPath .\docs\openapi-backend-current.json
```

Depois da atualização, comparar rotas, parâmetros e schemas antes de regenerar o cliente.

## Ativação de convite — 29/09/2026
Implementada na branch codex/invitation-activation. Veja [o contrato](contrato-ativacao-convite.md). Os snapshots foram obtidos do Swagger real e os tipos regenerados. Implantar o backend antes do frontend; esta implementação local ainda não foi publicada.

## Reenvio na tela Pessoas
A ação agora atende convites pendentes válidos ou expirados. Veja [contrato de reenvio](contrato-reenvio-convite.md). Usa a rota existente; sem alteração no OpenAPI.
