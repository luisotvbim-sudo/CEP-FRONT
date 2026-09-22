# CEP Horas — administração web e desktop

Interface React + TypeScript compartilhada entre navegador e um executável Windows WPF/WebView2, com paleta laranja/cinza e logomarca oficial da Conceito Engenharia.

## Funcionalidades implementadas

- **Login:** autenticação, consulta de `/me`, renovação serializada de refresh token, logout, recuperação e redefinição de senha. A área de horas aceita `organizationAdmin` na organização da sessão e `systemAdmin` com seleção explícita de organização.
- **Pessoas:** pesquisa e paginação das associações Monday/VR, detalhes da pessoa, estado do convite, reenvio de convites expirados com confirmação e atalho para histórico. Convites pendentes não comprovam entrega de e-mail. O estado complementar de revogação vem de `/organization/invitations`; quando não disponível, a tela não afirma que o convite continua válido.
- **Associar e convidar:** busca de perfis ativos e ainda não associados, atualização de nome/e-mail ao trocar a seleção, sugestão entre Monday e VR nos dois sentidos por e-mail exato e único, seleção pelos IDs internos e confirmação humana da correspondência, nome/e-mail e convite com papel `User`, válido por 48 horas. A confirmação informa enfileiramento, não entrega.
- **Sincronização:** coleta incremental ou reprocessamento de 60 dias, consulta periódica enquanto executa, resultados, contagens, cobertura e falhas separados por fonte. Sucesso parcial e integração desabilitada são explícitos; não há percentual fictício.
- **Equipes:** cadastro, edição, ativação, pesquisa de contas ativas, vínculos de membros/gestores com vigência e encerramento. A função de gestor da equipe não muda o papel de acesso da conta.
- **Histórico:** consulta bruta por pessoa, fonte e período de até 60 dias inclusivos. Durações recebidas em segundos são apresentadas em horas/minutos/segundos, sem converter `null` em zero. Datas com horário usam `America/Sao_Paulo`; datas civis mantêm o dia informado pela API.

Todas as chamadas usam o [OpenAPI versionado](docs/openapi.json). A base administrativa é `/api/v1/organization/time-control`. Para `organizationAdmin`, a organização é determinada pela sessão. Para `systemAdmin`, a interface lista as organizações e envia `organizationId` na query de cada operação; o backend valida o contexto e mantém o ator real na auditoria. Dados simulados existem somente nos testes.

O [briefing antigo](docs/briefing-consulta-inicial.md) é histórico e não orienta a integração atual. `/api/v1/time-logs` não existe no contrato e não é chamado.

## Executar no navegador

Pré-requisitos: Node.js 22.12+ ou 24 e pnpm.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Abra `http://127.0.0.1:5173`. O proxy Vite encaminha `/api` para `http://127.0.0.1:8080`, sem presumir CORS liberado. Para outro destino, copie `.env.example` para `.env` e ajuste `CEP_API_URL`.

Use uma conta existente `OrganizationAdmin`. Não há credenciais fixas ou cadastro público. Solicite a senha ao responsável e insira-a na interface; não a grave em scripts, código, capturas ou Git. Confira `/health/ready`: Swagger acessível sozinho não comprova conexão com o banco.

## Executável Windows

Pré-requisitos adicionais: .NET SDK 10 e Microsoft Edge WebView2 Runtime.

```powershell
pnpm build
dotnet run --project desktop/CepHoras.Desktop -c Debug
```

Debug usa a API local por padrão. O executável está em `desktop/CepHoras.Desktop/bin/Debug/net10.0-windows/CepHoras.exe`. A pasta inteira, incluindo `wwwroot`, é necessária; não distribua apenas o `.exe`.

```powershell
pnpm build
dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained false
```

Release usa `https://api.cep.lat` por padrão. `CEP_API_URL` substitui o destino; HTTP só é permitido em loopback. O host usa origem virtual HTTPS para assets locais, valida a origem das mensagens e permite apenas operações documentadas. Links HTTPS de atividades, acionados pelo usuário, abrem no navegador externo. Navegação interna para outras origens e permissões são bloqueadas; DevTools e menus de contexto são desativados em Release. Instalador, assinatura, atualização automática e publicação são etapas posteriores.

## Sessão e segurança

`AuthClient` separa componentes do transporte. `HttpAuthClient` usa o proxy de mesma origem no navegador; `DesktopAuthClient` usa o bridge WPF. Os dois renovam antes da expiração ou após um 401 e serializam a rotação para impedir uso concorrente do mesmo refresh token. Falha ou resposta perdida na renovação exige novo login, sem reapresentar o token antigo. Falhas de rede em operações de gravação não causam repetição automática.

- **Navegador:** a API guarda o refresh token em cookie `HttpOnly`, protegido com Data Protection, `SameSite=Strict`, `Secure` em HTTPS e vencimento absoluto de até sete dias desde o login. Recarregar, fechar/reabrir e abrir outra aba retomam a sessão por `POST /auth/web/refresh`; access token fica apenas em memória. Login/logout usam `/auth/web/login` e `/auth/web/logout`. O backend exige origem correspondente ao Host do proxy e `X-CEP-Web-Session: 1` contra CSRF. HTTP é permitido somente em loopback fora de produção. Web Locks serializa login, refresh e logout entre abas; BroadcastChannel propaga encerramento/troca de conta. Nenhum token é gravado por JavaScript. Após resposta perdida, somente um marcador de falha sem identidade é salvo em localStorage para impedir replay ao recarregar, até novo login. Logout e revogação encerram o acesso antes dos sete dias.
- **Desktop:** access token fica no host nativo. Refresh token é criptografado por Windows DPAPI (`CurrentUser`) em `%LOCALAPPDATA%/Conceito/CepHoras/Sessions`, separado pela origem da API. O processo impede outra instância de disputar o mesmo arquivo. A retomada rotaciona o token e revalida `/me`. O logout revoga a sessão e remove o arquivo. O token antigo é removido antes da rotação para evitar replay após interrupção.
- **Bridge:** devolve metadados da sessão e resultados permitidos, nunca tokens. A lista de rotas permitidas é validada no host. O servidor continua responsável pela autorização e pelo isolamento entre organizações.

`ProblemDetails` é tratado por `code`; `correlationId` é preservado para suporte. Estados de carregamento, ausência de dados, falha de conexão, acesso negado, sessão expirada, associação duplicada e integração desabilitada são apresentados na interface.

Para publicar na web, sirva `dist/` por HTTPS e configure proxy de mesma origem para `/api`, preservando `Host`, `Origin`, `Cookie` e `Set-Cookie`, sem cache nas rotas de sessão e respeitando as regras de proxy confiável da CEP API. Publique a API com `/auth/web/*` antes deste frontend. As chaves Data Protection do servidor precisam persistir entre atualizações. Vite é desenvolvimento/prévia. Não abra por `file://`. O build inclui CSP sem scripts de terceiros; fontes e logo são locais. Tokens Monday/VR pertencem exclusivamente ao backend.

## Contrato e validação

Antes de adaptar integrações:

```powershell
./scripts/sync-openapi.ps1
pnpm types:api
```

Tipos gerados: `src/auth/api-schema.d.ts`.

```powershell
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
dotnet build desktop/CepHoras.Desktop -c Debug
node scripts/test-desktop.mjs
```

Os testes unitários cobrem autenticação, rotação concorrente, falha de renovação, contratos de erro, datas e durações. Playwright cobre login e administração em desktop/celular, com fixtures isoladas e verificação automática de acessibilidade. O teste do executável usa WPF/WebView2 real e servidor HTTP descartável para verificar chamadas protegidas, rotação única, DPAPI, retomada após reiniciar, isolamento dos tokens, bloqueio de rotas e logout. Capturas/perfis de teste ficam em `.local`, ignorada pelo Git. As capturas administrativas com dados fictícios são identificadas.

```powershell
node scripts/test-desktop.mjs --live
```

Esse teste opcional verifica apenas rejeição de uma conta inexistente pela API local através do host real; não utiliza conta real nem envia e-mail. Não equivale à validação autenticada dos fluxos administrativos.

## Dependências para homologação

1. Login manual de um responsável com conta `OrganizationAdmin` para testar consultas e alterações autorizadas na organização local.
2. Na preparação inicial, Monday/VR estavam desabilitados no Docker local; confira a configuração atual antes da homologação. Perfis, associação com dados reais e cobertura/histórico importados dependem de configuração segura dessas integrações no servidor. O frontend não habilita fontes nem recebe seus tokens.
3. Convites enfileirados podem ser inspecionados no Mailpit em `http://127.0.0.1:8025`. O envio/aceite real depende de perfis disponíveis e de um destinatário de teste autorizado. A tela pública de aceite de convite ainda é uma próxima etapa; esta entrega cobre a criação e acompanhamento administrativo.
4. Comparação consolidada por turno, justificativas, aprovação do gestor e notificações não estão disponíveis na API principal e não foram simuladas.
5. Publicação web, instalador e assinatura do executável ainda não foram executados.
