# Compatibilidade entre CEP-FRONT e CEP-API

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
