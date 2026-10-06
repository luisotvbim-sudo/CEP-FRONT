# Desktop local TESTE

Ambiente portÃ¡til de desenvolvimento em `codex/desktop-test-environment`. NÃ£o instalar MSI, serviÃ§o ou polÃ­ticas para este fluxo. VM/upgrade MSI constituem etapa futura. A API e os volumes existentes do Compose `CEP-ORQUESTRADOR/.local/test-stack/compose.yaml` sÃ£o preservados.

## Base conferida

- Web/test local: `codex/test-minha-analise`, `64a2069702e3fbdf7eafdb1cca172a0633b869c5`, base desta branch. Inclui sprint 17 dias, detalhes Monday/VR, senha e paginaÃ§Ã£o estreita.
- Host integrado 0.4.11: ancestral PR #15 (`72941ad`); entrega `origin/codex/instalador-pronto` em `6137a27`. A main remota observada em `8f0c44a` jÃ¡ contÃ©m essa integraÃ§Ã£o; as matrizes auditadas de 04/10 nÃ£o representam essa main posterior.
- [PR #16](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/16): aberta, `codex/liberacao-energia-ao-fechar`, `b467c0a2571fdb8324f99d181934e21f6d785cfa`, polÃ­ticas 0.4.12 fora de main. Conferida, mas nÃ£o incorporada ao portÃ¡til: aplicar/liberar polÃ­ticas Windows nÃ£o pertence a esta etapa.
- ImplementaÃ§Ã£o TESTE: `cf79593`. ConfiguraÃ§Ã£o de teste separada em commit prÃ³prio; nÃ£o selecionar esse commit para produÃ§Ã£o. DocumentaÃ§Ã£o da entrega em commit seguinte.
- API Docker observada: `cep-test-api:local`, label de revisÃ£o `a2715de426ff74e9374373a95ee3c9e55e12a4ad`. `/health/ready` retornou 200. Swagger tem os mesmos 53 nomes de paths e nomes de schemas do contrato consumido. NÃ£o foi substituÃ­do snapshot por uma API local.

## Abrir e testar

No worktree `C:\Users\luizi\.codex\worktrees\desktop-test-environment\CEP-FRONT`:

```powershell
./scripts/start-desktop-test.ps1 -Build -CheckOnly # primeira preparaÃ§Ã£o/rebuild
./scripts/start-desktop-test.ps1                 # abrir novamente
```

Requisitos: .NET SDK/Desktop Runtime 10, Node/pnpm conforme lockfile, WebView2 Runtime e API local ativa. O launcher verifica health e recusa payload gerenciado. Build Debug e assets ficam em `.local/desktop-environment/payload`; `config.private.json` e `process.private.json` sÃ£o ignorados. NÃ£o abrir o EXE diretamente: o launcher configura o isolamento.

TÃ­tulo, bandeja e rodapÃ© mostram TESTE/energia simulada. Fechar a janela mantÃ©m a bandeja; **Fechar CEP Horas** encerra o portÃ¡til. NÃ£o confundir essa bandeja com o CEP instalado. Executar o launcher novamente reapresenta a instÃ¢ncia TESTE existente.

Entrar manualmente com uma conta jÃ¡ autorizada da API de teste, sem salvar credenciais. Conferir escopo, Minha jornada/histÃ³rico/anÃ¡lise e notificaÃ§Ãµes conforme permissÃµes; sair pelo menu da conta para revogar sessÃ£o. Para testar retomada, encerrar pela bandeja sem logout e abrir novamente. Recarregar interface conserva perfil; recriar perfil conserva backup. NÃ£o registrar dados pessoais em Issues/capturas.

Energia usa `PowerBridgeHandler` e a revalidaÃ§Ã£o real da API, porÃ©m o sender Ã© `SimulatedPowerBroker`, sem IPC, processo, serviÃ§o, polÃ­tica ou chamada Windows. Aceita apenas as trÃªs aÃ§Ãµes e dez segundos; permite cancelamento/status. ApÃ³s a contagem, a simulaÃ§Ã£o termina e o PC permanece ligado. A decisÃ£o/override continuam pertencendo Ã  API; nÃ£o inventar permissÃ£o nem provisionar PIN por este roteiro.

## Isolamento

SessÃ£o/recebimentos/diagnÃ³sticos em `%LOCALAPPDATA%\Conceito\CepHoras-Test\Sessions`; WebView2 em `%LOCALAPPDATA%\Conceito\CepHoras-Test\WebView2`. Mutex derivado do diretÃ³rio de sessÃ£o. Refresh protegido por DPAPI CurrentUser; access token no host; renderer recebe somente metadados/resultados. O perfil de produÃ§Ã£o `%LOCALAPPDATA%\Conceito\CepHoras` nÃ£o Ã© usado. TESTE exige Debug, API exatamente `http://127.0.0.1:8080`, pastas fixas e ausÃªncia de marker gerenciado; a variÃ¡vel de ativaÃ§Ã£o nÃ£o habilita TESTE em Release.

O launcher remove argumentos herdados de depuraÃ§Ã£o WebView2. O driver de fixtures usa perfis descartÃ¡veis prÃ³prios e porta CDP loopback temporÃ¡ria; nÃ£o habilitar CDP na janela operacional TESTE.

## EvidÃªncia de 05/10/2026

- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm test`: passaram; 100 testes React.
- Publish Debug isolado e build Release: passaram, zero warnings/errors.
- `dotnet run --project desktop/CepHoras.Desktop.Tests -c Debug` e `-c Release`: sessÃ£o/DPAPI/rotas/energia e checks do simulador/guard passaram. Debug recusa API produÃ§Ã£o; Release ignora ativaÃ§Ã£o TESTE.
- `node scripts/test-desktop.mjs`: WPF/WebView2 real contra fixture descartÃ¡vel; login, chamadas protegidas, rotaÃ§Ã£o compartilhada, retomada/restart DPAPI, allowlist, isolamento de tokens, logout, popup reportado pelo Windows, root vazio/JS bloqueado, reload, recriaÃ§Ã£o e resume passaram.
- Janela operacional PID observado `47916`, payload isolado; diagnÃ³stico `ready`, tela de login e identidade TESTE conferidas visualmente. CEP instalado PID `32376` permaneceu em execuÃ§Ã£o; nÃ£o foi encerrado ou alterado. PIDs sÃ£o evidÃªncia da sessÃ£o, nÃ£o configuraÃ§Ã£o reutilizÃ¡vel.
- Verificação adicional do payload TESTE: bridge nativo anunciou energia v1 e `verify-api-unreachable` retornou `false` contra API Docker; sem autenticar ou agendar energia. Processo temporário de depuração encerrado e launcher operacional reaberto sem CDP.
- `git diff --check`: passou. Nenhuma instalaÃ§Ã£o MSI/serviÃ§o, aÃ§Ã£o real de energia, alteraÃ§Ã£o Compose/volume/conta/fonte, merge, release ou implantaÃ§Ã£o.

Limites: health e Swagger nÃ£o homologam conta, fonte, SMTP ou dados. Login/retomada autenticados na API Docker, permissÃµes por perfil e decisÃµes com fontes reais permanecem para teste manual autorizado. O driver validou integraÃ§Ã£o nativa com fixtures, nÃ£o o conteÃºdo das fontes de teste. Assinatura, polÃ­ticas, execuÃ§Ã£o de energia, Windows elevado, atualizaÃ§Ã£o/rollback MSI e VM nÃ£o foram homologados nesta etapa.
