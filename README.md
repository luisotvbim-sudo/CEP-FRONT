# CEP Horas — web, Windows e instalador

CEP-FRONT contém a interface React/TypeScript do CEP Horas, o host Windows WPF/WebView2, o serviço de controle e os scripts de empacotamento. A CEP API autentica, autoriza, consulta Monday/VR Mais, calcula horas e determina destinatários e decisões de energia.

## Contexto para começar ou retomar

Leia [AGENTS.md](AGENTS.md), [contexto atual](docs/CONTEXTO-ATUAL.md), [especificação funcional](docs/produto/especificacao-funcional.md) e [compatibilidade da API](docs/compatibilidade-backend.md). O [índice documental](docs/README.md) organiza os contratos e registra os documentos substituídos. A fila transversal é a do [CEP-ORQUESTRADOR](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues).

Referência auditada em 04/10/2026: Front `main` `eb63dbdc7f7bf83d0a4b51ee5567ed5aa80c138c` e API `main` `b36c6e149b42253b44860d98c6ffe44f98c53dd6`. Reconferir branch, SHA e alterações locais antes de trabalhar. Código, merge, CI, release, versão instalada e produção são evidências diferentes.

| Canal/base auditada | Capacidade Windows |
|---|---|
| `main`, `eb63dbd` | MSI corporativo 0.4.3, sessão protegida, bandeja, notificações, energia e recuperação de perfil |
| `codex/installer-integrado`, `dc58bde` | Evolução do MSI até 0.4.6, fora da `main` auditada |
| [PR #9](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/9), `95fbf5c` | Atualizador MSI e evoluções 0.4.7–0.4.9; recuperação WebView2 ampliada; integração e piloto completos pendentes |
| Prerelease `desktop-v0.2.0.1-test` | ZIP histórico de teste; sem migração automática para MSI |

A auditoria não encontrou release MSI estável nem comprovação de homologação completa entre versões. Consulte [aplicativo Windows](docs/aplicativo-windows.md), [contexto do instalador](docs/CONTEXTO-INSTALADOR.md), [instalador corporativo](docs/instalador-corporativo.md) e [menu de energia](docs/menu-energia.md) antes de instalar ou publicar. O [guia do atualizador MSI](docs/atualizador-msi.md) descreve a branch PR #9; sua presença documental não integra esse código à main.

## Capacidades existentes

- Login web/nativo, retomada, refresh rotativo, logout, recuperação/redefinição de senha e [ativação de convite sem emissão de sessão](docs/contrato-ativacao-convite.md).
- Pessoas, associação por IDs Monday/VR, convite e [reenvio administrativo](docs/contrato-reenvio-convite.md), diretórios paginados e sincronização normal de 7 dias ou administrativa de até 90 dias.
- Administração de organizações, usuários, times, vínculos com vigência e auditoria; Membro/Líder recebem respostas autorizadas pela API.
- [Histórico diário](docs/historico-diario.md) com detalhes de origem e totais retornados pelo servidor; valores desconhecidos permanecem nulos.
- [Configurações/agendas globais, envio manual, central pessoal e análises persistidas](docs/notificacoes-implementacao.md). Consultar uma análise não executa nova leitura das fontes.
- Menu de energia com decisão pessoal da API, liberação administrativa temporária por PIN e revalidação nativa no MSI corporativo.

Calendário de jornadas/exceções, workflow de casos e justificativas, decisões de líder, ranking completo e exportação de planilha/PDF permanecem evoluções de produto. A especificação conserva seus requisitos e decisões pendentes; eles não autorizam implementação automática.

## Desenvolvimento web

Requisitos: Node.js 22.12+ e pnpm na versão definida em `package.json`.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Abra `http://127.0.0.1:5173`. Vite encaminha `/api` para `http://127.0.0.1:8080`; copie `.env.example` para `.env` para configurar outro destino por `CEP_API_URL`. Use contas de teste autorizadas, sem gravar credenciais em arquivos, capturas ou Git. Swagger acessível não comprova banco, fontes ou fluxo autenticado.

`src/preview/` mantém uma ferramenta de revisão exclusivamente em desenvolvimento (`/?preview=analysis`), com exemplos identificados, sem API, envios reais ou persistência. O import condicionado a `import.meta.env.DEV` exclui-a da produção. Fixtures não demonstram homologação.

## Desenvolvimento Windows

Esta branch inclui a [refatoração do instalador e piloto 0.4.10](docs/refatoracao-instalador.md), vinculada à Issue central #14. Loading exige React montado e bridge funcional; recuperação automática é limitada e coordena cancelamento de energia, perfil e processos próprios. Serviço/MSI/atualizador e regressões estão documentados no relatório. Build de piloto e código em revisão não comprovam instalação, assinatura ou distribuição homologada.

Requisitos adicionais: .NET SDK 10 e Microsoft Edge WebView2 Runtime.

```powershell
pnpm build
dotnet run --project desktop/CepHoras.Desktop -c Debug
dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained false
```

Debug usa API local; Release usa `https://api.cep.lat`. `CEP_API_URL` permite substituir o destino; HTTP é aceito somente em loopback. Distribua a pasta publicada inteira, incluindo `wwwroot`. Builds portáteis, instalação por perfil e MSI corporativo possuem capacidades e requisitos distintos; seguir [aplicativo Windows](docs/aplicativo-windows.md).

## Sessão, contrato e publicação

Web usa mesma origem, access token somente em memória e refresh em cookie `HttpOnly` protegido pela API. Desktop guarda tokens no host com DPAPI e entrega somente metadados/resultados permitidos ao React. Não armazenar tokens ou dados de horas em `localStorage`/IndexedDB nem chamar Monday/VR diretamente. Resposta incerta ao rotacionar refresh exige novo login, sem replay do token antigo.

Os snapshots [real](docs/openapi-backend-current.json) e [consumido](docs/openapi.json) têm 52 paths e 72 schemas na base auditada; tipos em `src/auth/api-schema.d.ts`. Para mudança de contrato, conferir primeiro a API/commit em execução, atualizar snapshot real, comparar operações/schemas, atualizar o contrato consumido e executar `pnpm types:api` junto com cliente/allowlist correspondentes. Não regredir snapshots por consultar um servidor antigo.

O [deploy web](deploy/README.md) gera somente `cep-front`, sem porta publicada. Nginx de borda fornece HTTPS e encaminha `/api/` diretamente à API independente, preservando headers/cookies e sem cache de sessão. O Nginx interno do Front rejeita `/api/`. Persistência Data Protection e migrations pertencem à implantação da API.

## Verificações

Execute as verificações pertinentes à alteração; o registro da entrega deve informar o que realmente foi executado e em qual base.

```powershell
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
dotnet run --project desktop/CepHoras.Desktop.Tests -c Release
dotnet run --project desktop/CepHoras.Updates.Tests -c Release
dotnet build desktop/CepHoras.Desktop -c Debug
node scripts/test-desktop.mjs
```

Os testes usam fixtures identificadas e, no driver WPF, API descartável. Não comprovam fontes reais, entrega de e-mail, versão na VM, políticas da frota ou upgrade MSI. Mudanças somente documentais exigem consistência de links, bases e contratos; esta reescrita não executa instalação, ações de energia ou testes autenticados.
