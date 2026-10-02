# CEP Horas — administração web e desktop

Interface React + TypeScript compartilhada entre navegador e um executável Windows WPF/WebView2, com paleta laranja/cinza e logomarca oficial da Conceito Engenharia.

## Fonte de verdade e compatibilidade

- A [especificação funcional](docs/produto/especificacao-funcional.md) define a visão do produto, os perfis Coordenador, Líder e Membro e distingue o que está entregue, parcial e planejado.
- O [snapshot OpenAPI do backend atual](docs/openapi-backend-current.json) registra o contrato exposto pela CEP API local na `main` `b36c6e1`, sincronizado em 01/10/2026.
- O [relatório de compatibilidade](docs/compatibilidade-backend.md) registra o alinhamento atual e separa o que já existe no backend das telas ainda pendentes no front.
- O [contexto consolidado do controle de energia](docs/contexto-controle-energia-instalador.md) reúne produto, API, WPF, serviço, instalador, segurança, testes e rollout do PIN administrativo.
- `docs/openapi.json` originou o cliente atual e está alinhado em rotas e schemas com o snapshot real.

## Funcionalidades implementadas

- **Menu de energia:** rodapé recolhível nas áreas autenticadas com verificação pessoal pela API e PIN administrativo para liberação pessoal de cinco minutos. Cada ação continua sendo verificada. No instalador corporativo, o bridge nativo revalida a decisão no host e agenda no serviço local com dez segundos para cancelamento. No navegador, não executa ações do sistema. A liberação depende da migração e do provisionamento seguro do PIN no backend; veja [contrato e validação](docs/menu-energia.md).

- **Login:** desktop e navegador usam autenticação, `/me`, refresh rotativo, logout, recuperação e redefinição de senha disponíveis na API atual. No navegador, o refresh fica em cookie protegido e não é exposto ao React.
- **Pessoas:** pesquisa e paginação das associações Monday/VR, detalhes da pessoa, estado do convite, reenvio de convites pendentes (válidos ou expirados) com confirmação e atalho para histórico. Convites pendentes não comprovam entrega de e-mail. O estado complementar de revogação vem de `/organization/invitations`; quando não disponível, a tela não afirma que o convite continua válido.
- **Associar e convidar:** busca de perfis ativos e ainda não associados, atualização de nome/e-mail ao trocar a seleção, sugestão entre Monday e VR nos dois sentidos por e-mail exato e único, seleção pelos IDs internos e confirmação humana da correspondência, nome/e-mail e convite com papel `User`, válido por 48 horas. A confirmação informa enfileiramento, não entrega.
- **Sincronização:** atualização normal dos últimos 7 dias ou reprocessamento administrativo de até 90 dias, consulta periódica enquanto executa, resultados, contagens, cobertura e falhas separados por fonte. Sucesso parcial e integração desabilitada são explícitos; não há percentual fictício.
- **Times:** cadastro, edição, ativação, pesquisa de contas ativas e vínculos de membros/líderes com vigência e encerramento. A área operacional de Líder consulta somente os times geridos devolvidos pela API e associa pessoas pelo `userId`.
- **Histórico:** consulta por pessoa, fonte e período de até 90 dias inclusivos, [agrupada em linhas diárias expansíveis](docs/historico-diario.md) nas áreas administrativa, pessoal e dos times. Os totais Monday/VR e a diferença vêm da API; `null` não vira zero. Datas com horário usam `America/Sao_Paulo`; datas civis mantêm o dia informado pela API.
- **Membro/Líder:** navegação pessoal, histórico bruto, estado da última tentativa de atualização própria e sincronização normal de 7 dias. Líder também consulta pessoas dos times geridos; ausência de vínculo ou registro não é exibida como zero horas.
- **Usuários e auditoria:** Coordenador e `SystemAdmin` com organização selecionada consultam usuários, alteram nome/papel/situação preservando produtos, criam convites administrativos e leem eventos administrativos. Alteração de acesso revoga sessões.

O código atual foi gerado a partir do [contrato](docs/openapi.json). A base é `/api/v1/organization/time-control`. O Coordenador administra a organização inteira; o `systemAdmin` seleciona explicitamente uma organização; Líder e Membro recebem respostas filtradas pelo backend. Dados simulados existem somente nos testes.

O [briefing antigo](docs/briefing-consulta-inicial.md) é histórico e não orienta a integração atual. `/api/v1/time-logs` não existe no contrato e não é chamado.

## Executar no navegador

Uma [prévia isolada de análises e notificações](docs/previa-analises-notificacoes.md) está disponível em desenvolvimento em `http://127.0.0.1:5173/?preview=analysis`. As sete telas usam exemplos explicitamente identificados, sem API ou envios reais. O módulo não é incluído no build de produção.

Pré-requisitos: Node.js 22.12+ ou 24 e pnpm.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Abra `http://127.0.0.1:5173`. O proxy Vite encaminha `/api` para `http://127.0.0.1:8080`, sem presumir CORS liberado. Para outro destino, copie `.env.example` para `.env` e ajuste `CEP_API_URL`.

Use uma conta existente no navegador ou no executável desktop. Não há credenciais fixas ou cadastro público. Solicite a senha ao responsável e insira-a na interface; não a grave em scripts, código, capturas ou Git. Confira `/health/ready`: Swagger acessível sozinho não comprova conexão com o banco.

## Executável Windows

O instalador corporativo unificado inclui o aplicativo, inicialização automática, serviço `CepHorasControl` e políticas locais de energia. Nas áreas autenticadas, o menu discreto oferece Desligar, Reiniciar, Hibernar e Verificar status. A API decide conforme a análise/tolerância do usuário; uma ação liberada aguarda dez segundos e pode ser cancelada. Quando a API realmente não responde no transporte, o host permite a contingência local. Veja [menu de energia](docs/menu-energia.md) e [instalador corporativo](docs/instalador-corporativo.md).

```powershell
./scripts/build-corporate-msi.ps1 -Version 0.4.7 -UpdateSigningKeyPath '<chave local da TI protegida por DPAPI>'
```

O MSI é por máquina e exige autorização administrativa. Ele altera direitos e políticas do Windows; instalação, ações reais e restauração devem ser homologadas primeiro numa VM ou máquina piloto. Builds portáteis e o navegador não executam ações de energia.

Desde o MSI 0.4.3, o aplicativo mantém uma única instância por sessão: abrir o atalho traz a instância iniciada pelo serviço para a frente, sem disputar o perfil WebView2. Se a interface nativa não carregar, **Reiniciar CEP Horas** encerra somente processos do CEP Horas e do WebView2 pertencentes àquela instância, preserva o perfil anterior como backup, recria o navegador local e abre o aplicativo novamente. O serviço `CepHorasControl` continua ativo para manter as políticas e relançar o host; o botão não encerra serviços do Windows nem executa ação de energia.

Desde o MSI 0.4.4, o menu aberto com o botão direito no ícone do CEP Horas perto do relógio inclui **Fechar CEP Horas**. A confirmação usa somente a data local no formato `ddMMyy` seguida de `#pec`, inclusive zeros à esquerda, e funciona sem internet. A senha não é exibida, persistida ou registrada. No MSI 0.4.5, o fechamento autorizado restaura o estado original das políticas e suspende o relançamento apenas para a sessão Windows atual; abrir o programa manualmente reaplica o bloqueio e reativa a supervisão. Logoff e reinício do serviço também reaplicam a proteção antes da próxima sessão.

A página pública `/download` apresenta o pacote Windows de teste, requisitos, instruções e links da release. Ela não inicia uma sessão nem consulta a API. O download usa uma tag fixa do GitHub para não confundir versões de teste com o MSIX assinado.

A integração do instalador com bandeja, WebView2 e teste de popup nativo está descrita em [Aplicativo Windows](docs/aplicativo-windows.md). O MSI 0.4.7 inclui o atualizador pelo serviço: busca releases estáveis, apresenta **Atualizar agora/Depois** e aplica pacotes validados sem pedir credenciais administrativas ao usuário. A descoberta ocorre ao abrir, a cada seis horas e por **Verificar atualizações** na bandeja. A instalação inicial requer administrador. [Atualizador MSI](docs/atualizador-msi.md) descreve chave de publicação, manifesto assinado e piloto entre duas versões. Homologação real e distribuição permanecem pendentes até evidência operacional. O [contexto anterior](docs/contexto-atualizador-msi.md) preserva o desenho e o histórico.

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

O fluxo histórico MSIX consulta releases `desktop-vX.Y.Z.W` ao abrir e a cada seis horas. Com uma versão maior e asset `CEP-Horas-win-x64.msix`, apresenta **Atualizar**, verifica SHA-256 e identidade e abre o Instalador de Aplicativos; o Windows valida a assinatura MSIX. Esse fluxo é separado do MSI corporativo 0.4.7 e não roda no instalador local de teste nem no navegador. Para construir um MSIX estrutural de teste, **não instalável nem distribuível**:

```powershell
./scripts/build-desktop-msix.ps1 -Publisher 'CN=Conceito Engenharia' -UnsignedForTest
```

A distribuição MSIX ainda depende de certificado confiável e homologação próprios. O MSI corporativo self-contained inicia em cada logon, mantém o aplicativo em bandeja e instala o serviço de controle. Seu bootstrap 0.4.7 inclui a pública de confiança e o atualizador do serviço; as próximas releases usam manifesto com assinatura destacada RSA-PSS. Essa assinatura autentica o canal de atualização e não equivale a Authenticode do MSI. O procedimento e os limites de homologação estão em [atualizador MSI](docs/atualizador-msi.md).

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
dotnet run --project desktop/CepHoras.Desktop.Tests -c Release
dotnet run --project desktop/CepHoras.Updates.Tests -c Release
dotnet build desktop/CepHoras.Desktop -c Debug
node scripts/test-desktop.mjs
```

Os testes unitários cobrem autenticação, rotação concorrente, falha de renovação, contratos de erro, datas e durações. Playwright cobre login e administração em desktop/celular, com fixtures isoladas e verificação automática de acessibilidade. O teste do executável usa WPF/WebView2 real e servidor HTTP descartável para verificar chamadas protegidas, rotação única, DPAPI, retomada após reiniciar, isolamento dos tokens, bloqueio de rotas e logout. Capturas/perfis de teste ficam em `.local`, ignorada pelo Git. As capturas administrativas com dados fictícios são identificadas.

```powershell
node scripts/test-desktop.mjs --live
```

Esse teste opcional verifica apenas rejeição de uma conta inexistente pela API local através do host real; não utiliza conta real nem envia e-mail. Não equivale à validação autenticada dos fluxos administrativos.

## Dependências para homologação

O [relatório de refatoração](docs/refatoracao.md) descreve as responsabilidades compartilhadas, os testes adicionais e os limites da validação de 29/09/2026.

1. Login manual no navegador e no executável desktop com uma conta de homologação para validar cookies, retomada, rotação e logout contra o ambiente publicado.
2. Na preparação inicial, Monday/VR estavam desabilitados no Docker local; confira a configuração atual antes da homologação. Perfis, associação com dados reais e cobertura/histórico importados dependem de configuração segura dessas integrações no servidor. O frontend não habilita fontes nem recebe seus tokens.
3. Convites enfileirados podem ser inspecionados no Mailpit em `http://127.0.0.1:8025`. O envio/aceite real depende de perfis disponíveis e de um destinatário de teste autorizado. A tela pública de aceite aguarda um contrato web seguro: o endpoint atual retorna refresh token no corpo e não deve ser ligado diretamente ao React.
4. Comparação consolidada por turno, justificativas, decisão do líder e notificações não estão disponíveis na API principal e não foram simuladas.
5. As novas telas operacionais e administrativas foram verificadas com contrato e mocks de navegador. A instalação local de teste e o acesso autenticado de Coordenador foram verificados em Windows; Membro e Líder ainda exigem homologação com contas próprias. Publicação web, instalador distribuível assinado e assinatura do executável ainda não foram executados.
