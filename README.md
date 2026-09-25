# CEP Horas — administração web e desktop

Interface React + TypeScript compartilhada entre navegador e um executável Windows WPF/WebView2, com paleta laranja/cinza e logomarca oficial da Conceito Engenharia.

## Fonte de verdade e compatibilidade

- A [especificação funcional](docs/produto/especificacao-funcional.md) define a visão do produto, os perfis Coordenador, Líder e Membro e distingue o que está entregue, parcial e planejado.
- O [snapshot OpenAPI do backend atual](docs/openapi-backend-current.json) registra o contrato realmente exposto pela branch `codex/integracao-monday-vrmais` da CEP API.
- O [relatório de compatibilidade](docs/compatibilidade-backend.md) registra o alinhamento atual e separa o que já existe no backend das telas ainda pendentes no front.
- `docs/openapi.json` originou o cliente atual e está alinhado em rotas e schemas com o snapshot real.

## Funcionalidades implementadas

- **Login:** desktop e navegador usam autenticação, `/me`, refresh rotativo, logout, recuperação e redefinição de senha disponíveis na API atual. No navegador, o refresh fica em cookie protegido e não é exposto ao React.
- **Pessoas:** pesquisa e paginação das associações Monday/VR, detalhes da pessoa, estado do convite, reenvio de convites expirados com confirmação e atalho para histórico. Convites pendentes não comprovam entrega de e-mail. O estado complementar de revogação vem de `/organization/invitations`; quando não disponível, a tela não afirma que o convite continua válido.
- **Associar e convidar:** busca de perfis ativos e ainda não associados, atualização de nome/e-mail ao trocar a seleção, sugestão entre Monday e VR nos dois sentidos por e-mail exato e único, seleção pelos IDs internos e confirmação humana da correspondência, nome/e-mail e convite com papel `User`, válido por 48 horas. A confirmação informa enfileiramento, não entrega.
- **Sincronização:** atualização normal dos últimos 7 dias ou reprocessamento administrativo de até 90 dias, consulta periódica enquanto executa, resultados, contagens, cobertura e falhas separados por fonte. Sucesso parcial e integração desabilitada são explícitos; não há percentual fictício.
- **Times:** cadastro, edição, ativação, pesquisa de contas ativas e vínculos de membros/líderes com vigência e encerramento. A área operacional de Líder consulta somente os times geridos devolvidos pela API e associa pessoas pelo `userId`.
- **Histórico:** consulta bruta por pessoa, fonte e período de até 90 dias inclusivos. Durações recebidas em segundos são apresentadas em horas/minutos/segundos, sem converter `null` em zero. Datas com horário usam `America/Sao_Paulo`; datas civis mantêm o dia informado pela API.
- **Membro/Líder:** navegação pessoal, histórico bruto, estado da última tentativa de atualização própria e sincronização normal de 7 dias. Líder também consulta pessoas dos times geridos; ausência de vínculo ou registro não é exibida como zero horas.
- **Usuários e auditoria:** Coordenador e `SystemAdmin` com organização selecionada consultam usuários, alteram nome/papel/situação preservando produtos, criam convites administrativos e leem eventos administrativos. Alteração de acesso revoga sessões.

O código atual foi gerado a partir do [contrato](docs/openapi.json). A base é `/api/v1/organization/time-control`. O Coordenador administra a organização inteira; o `systemAdmin` seleciona explicitamente uma organização; Líder e Membro recebem respostas filtradas pelo backend. Dados simulados existem somente nos testes.

O [briefing antigo](docs/briefing-consulta-inicial.md) é histórico e não orienta a integração atual. `/api/v1/time-logs` não existe no contrato e não é chamado.

## Executar no navegador

Pré-requisitos: Node.js 22.12+ ou 24 e pnpm.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Abra `http://127.0.0.1:5173`. O proxy Vite encaminha `/api` para `http://127.0.0.1:8080`, sem presumir CORS liberado. Para outro destino, copie `.env.example` para `.env` e ajuste `CEP_API_URL`.

Use uma conta existente no navegador ou no executável desktop. Não há credenciais fixas ou cadastro público. Solicite a senha ao responsável e insira-a na interface; não a grave em scripts, código, capturas ou Git. Confira `/health/ready`: Swagger acessível sozinho não comprova conexão com o banco.

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

Release usa `https://api.cep.lat` por padrão. `CEP_API_URL` substitui o destino; HTTP só é permitido em loopback. O host usa origem virtual HTTPS para assets locais, valida a origem das mensagens e permite apenas operações documentadas. Links HTTPS de atividades, acionados pelo usuário, abrem no navegador externo. Navegação interna para outras origens e permissões são bloqueadas; DevTools e menus de contexto são desativados em Release.

Para instalar o pacote publicado no perfil Windows atual, sem privilégio de administrador:

```powershell
dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained false -o .local/package/CEP-Horas-win-x64
./scripts/install-desktop.ps1
```

O script valida o pacote e os arquivos copiados, instala em `%LOCALAPPDATA%/Programs/Conceito/CEP Horas` e cria o atalho `CEP Horas` no menu Iniciar. Ele se recusa a substituir uma instalação ou um atalho existente. Esse instalador local de teste **não recebe atualizações** e não migra automaticamente para MSIX.

O caminho de atualização do desktop é um pacote MSIX assinado, distribuído como release pública no GitHub. O app MSIX consulta releases `desktop-vX.Y.Z.W` ao abrir e a cada 6 horas enquanto estiver aberto. Quando encontrar uma versão maior com o asset `CEP-Horas-win-x64.msix`, mostra “Atualizar” na própria janela; após o clique, verifica SHA-256 e identidade do pacote e abre o Instalador de Aplicativos do Windows. O Windows valida a assinatura antes da instalação. A checagem não roda no instalador local de teste nem no navegador. Para construir um pacote estrutural de teste, **não instalável nem distribuível**:

```powershell
./scripts/build-desktop-msix.ps1 -Publisher 'CN=Conceito Engenharia' -UnsignedForTest
```

Para distribuir, é necessário obter assinatura confiável, gerar o MSIX assinado com `-CertificateThumbprint`, validar a instalação/atualização em outro PC e publicar o asset em uma release estável com tag e versão correspondentes. Ainda não há certificado nem release desktop; portanto a atualização real **não está ativada**. O pacote atual é framework-dependent e exige .NET Desktop Runtime 10 e Microsoft Edge WebView2 Runtime. Inicialização com o Windows, execução em bandeja e notificações de negócio continuam pendentes; avisos de atualização são um mecanismo separado.

O [handoff do aplicativo Windows](docs/desktop-handoff.md) registra o estado testado, dependências de notificações, estratégia de atualização ainda pendente e os passos para continuar em outro computador.

## Sessão e segurança

`AuthClient` separa componentes do transporte. `HttpAuthClient` usa o proxy de mesma origem no navegador; `DesktopAuthClient` usa o bridge WPF. Os dois renovam antes da expiração ou após um 401 e serializam a rotação para impedir uso concorrente do mesmo refresh token. Falha ou resposta perdida na renovação exige novo login, sem reapresentar o token antigo. Falhas de rede em operações de gravação não causam repetição automática.

- **Navegador:** o refresh token fica em cookie `HttpOnly`, protegido com Data Protection, `SameSite=Strict`, `Secure` em HTTPS e vencimento absoluto de até sete dias. A retomada usa `POST /auth/web/refresh`; login/logout usam `/auth/web/login` e `/auth/web/logout`. Web Locks serializa operações entre abas e BroadcastChannel propaga encerramento/troca de conta.
- **Desktop:** access token fica no host nativo. Refresh token é criptografado por Windows DPAPI (`CurrentUser`) em `%LOCALAPPDATA%/Conceito/CepHoras/Sessions`, separado pela origem da API. O processo impede outra instância de disputar o mesmo arquivo. A retomada rotaciona o token e revalida `/me`. O logout revoga a sessão e remove o arquivo. O token antigo é removido antes da rotação para evitar replay após interrupção.
- **Bridge:** devolve metadados da sessão e resultados permitidos, nunca tokens. A lista de rotas permitidas é validada no host. O servidor continua responsável pela autorização e pelo isolamento entre organizações.

`ProblemDetails` é tratado por `code`; `correlationId` é preservado para suporte. Estados de carregamento, ausência de dados, falha de conexão, acesso negado, sessão expirada, associação duplicada e integração desabilitada são apresentados na interface.

Para publicar na web, sirva `dist/` por HTTPS e configure proxy de mesma origem para `/api`, preservando `Host`, `Origin`, `Cookie` e `Set-Cookie`, sem cache nas rotas de sessão e respeitando as regras de proxy confiável da CEP API. As chaves Data Protection do servidor precisam persistir entre atualizações. Vite é desenvolvimento/prévia. Não abra por `file://`. O build inclui CSP sem scripts de terceiros; fontes e logo são locais. Tokens Monday/VR pertencem exclusivamente ao backend.

## Contrato e validação

Antes de adaptar integrações, atualize o contrato real:

```powershell
./scripts/sync-openapi.ps1 -OutputPath ./docs/openapi-backend-current.json
```

Compare o snapshot real com `docs/openapi.json`. Quando rotas ou schemas mudarem, execute `pnpm types:api` e adapte cliente e testes no mesmo trabalho. Tipos gerados: `src/auth/api-schema.d.ts`.

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

1. Login manual no navegador e no executável desktop com uma conta de homologação para validar cookies, retomada, rotação e logout contra o ambiente publicado.
2. Na preparação inicial, Monday/VR estavam desabilitados no Docker local; confira a configuração atual antes da homologação. Perfis, associação com dados reais e cobertura/histórico importados dependem de configuração segura dessas integrações no servidor. O frontend não habilita fontes nem recebe seus tokens.
3. Convites enfileirados podem ser inspecionados no Mailpit em `http://127.0.0.1:8025`. O envio/aceite real depende de perfis disponíveis e de um destinatário de teste autorizado. A tela pública de aceite aguarda um contrato web seguro: o endpoint atual retorna refresh token no corpo e não deve ser ligado diretamente ao React.
4. Comparação consolidada por turno, justificativas, decisão do líder e notificações não estão disponíveis na API principal e não foram simuladas.
5. As novas telas operacionais e administrativas foram verificadas com contrato e mocks de navegador. A instalação local de teste e o acesso autenticado de Coordenador foram verificados em Windows; Membro e Líder ainda exigem homologação com contas próprias. Publicação web, instalador distribuível assinado e assinatura do executável ainda não foram executados.
