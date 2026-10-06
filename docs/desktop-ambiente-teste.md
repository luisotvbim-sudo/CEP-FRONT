# Desktop local TESTE

Ambiente portátil de desenvolvimento em `codex/desktop-test-environment`. Não instalar MSI, serviço ou políticas para este fluxo. VM/upgrade MSI constituem etapa futura. A API e os volumes existentes do Compose `CEP-ORQUESTRADOR/.local/test-stack/compose.yaml` são preservados.

## Base conferida

- Web/test local: `codex/test-minha-analise`, `64a2069702e3fbdf7eafdb1cca172a0633b869c5`, base desta branch. Inclui sprint 17 dias, detalhes Monday/VR, senha e paginação estreita.
- Host integrado 0.4.11: ancestral PR #15 (`72941ad`); entrega `origin/codex/instalador-pronto` em `6137a27`. A main remota observada em `8f0c44a` já contém essa integração; as matrizes auditadas de 04/10 não representam essa main posterior.
- [PR #16](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/16): aberta, `codex/liberacao-energia-ao-fechar`, `b467c0a2571fdb8324f99d181934e21f6d785cfa`, políticas 0.4.12 fora de main. Conferida, mas não incorporada ao portátil: aplicar/liberar políticas Windows não pertence a esta etapa.
- Implementação TESTE: `cf79593`, complementada por `8302615` (guarda do bridge simulado e saída portátil sem código diário). Configuração de teste separada em commit próprio; não selecionar esse commit para produção. Documentação da entrega em commit seguinte.
- API Docker observada: `cep-test-api:local`, label de revisão `a2715de426ff74e9374373a95ee3c9e55e12a4ad`. `/health/ready` retornou 200. Swagger tem os mesmos 53 nomes de paths e nomes de schemas do contrato consumido. Não foi substituído snapshot por uma API local.

## Abrir e testar

No worktree `C:\Users\luizi\.codex\worktrees\desktop-test-environment\CEP-FRONT`:

```powershell
./scripts/start-desktop-test.ps1 -Build -CheckOnly # primeira preparação/rebuild
./scripts/start-desktop-test.ps1                 # abrir novamente
```

Requisitos: .NET SDK/Desktop Runtime 10, Node/pnpm conforme lockfile, WebView2 Runtime e API local ativa. O launcher verifica health e recusa payload gerenciado. Build Debug e assets ficam em `.local/desktop-environment/payload`; `config.private.json` e `process.private.json` são ignorados. Não abrir o EXE diretamente: o launcher configura o isolamento.

Título, bandeja e rodapé mostram TESTE/energia simulada. Fechar a janela mantém a bandeja; **Fechar CEP Horas** encerra o portátil. Não confundir essa bandeja com o CEP instalado. Executar o launcher novamente reapresenta a instância TESTE existente.

Entrar manualmente com uma conta já autorizada da API de teste, sem salvar credenciais. Conferir escopo, Minha jornada/histórico/análise e notificações conforme permissões; sair pelo menu da conta para revogar sessão. Para testar retomada, encerrar pela bandeja sem logout e abrir novamente. Recarregar interface conserva perfil; recriar perfil conserva backup. Não registrar dados pessoais em Issues/capturas.

Energia usa `PowerBridgeHandler` e a revalidação real da API, porém o sender é `SimulatedPowerBroker`, sem IPC, processo, serviço, política ou chamada Windows. Aceita apenas as três ações e dez segundos; permite cancelamento/status. Após a contagem, a simulação termina e o PC permanece ligado. A decisão/override continuam pertencendo à API; não inventar permissão nem provisionar PIN por este roteiro.

## Isolamento

Sessão/recebimentos/diagnósticos em `%LOCALAPPDATA%\Conceito\CepHoras-Test\Sessions`; WebView2 em `%LOCALAPPDATA%\Conceito\CepHoras-Test\WebView2`. Mutex derivado do diretório de sessão. Refresh protegido por DPAPI CurrentUser; access token no host; renderer recebe somente metadados/resultados. O perfil de produção `%LOCALAPPDATA%\Conceito\CepHoras` não é usado. TESTE exige Debug, API exatamente `http://127.0.0.1:8080`, pastas fixas e ausência de marker gerenciado; a variável de ativação não habilita TESTE em Release.

O launcher remove argumentos herdados de depuração WebView2. O driver de fixtures usa perfis descartáveis próprios e porta CDP loopback temporária; não habilitar CDP na janela operacional TESTE.

## Evidência de 05/10/2026

- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm test`: passaram; 100 testes React.
- Publish Debug isolado e build Release: passaram, zero warnings/errors.
- `dotnet run --project desktop/CepHoras.Desktop.Tests -c Debug` e `-c Release`: sessão/DPAPI/rotas/energia e checks do simulador/guard passaram. Debug recusa API produção; Release ignora ativação TESTE.
- `node scripts/test-desktop.mjs`: WPF/WebView2 real contra fixture descartável; login, chamadas protegidas, rotação compartilhada, retomada/restart DPAPI, allowlist, isolamento de tokens, logout, popup reportado pelo Windows, root vazio/JS bloqueado, reload, recriação e resume passaram.
- Janela operacional PID observado `47916`, payload isolado; diagnóstico `ready`, tela de login e identidade TESTE conferidas visualmente. CEP instalado PID `32376` permaneceu em execução; não foi encerrado ou alterado. PIDs são evidência da sessão, não configuração reutilizável.
- Verificação adicional do payload TESTE: bridge nativo anunciou energia v1 e `verify-api-unreachable` retornou `false` contra API Docker; sem autenticar ou agendar energia. Processo temporário de depuração encerrado e launcher operacional reaberto sem CDP.
- `git diff --check`: passou. Nenhuma instalação MSI/serviço, ação real de energia, alteração Compose/volume/conta/fonte, merge, release ou implantação.

Limites: health e Swagger não homologam conta, fonte, SMTP ou dados. Login/retomada autenticados na API Docker, permissões por perfil e decisões com fontes reais permanecem para teste manual autorizado. O driver validou integração nativa com fixtures, não o conteúdo das fontes de teste. Assinatura, políticas, execução de energia, Windows elevado, atualização/rollback MSI e VM não foram homologados nesta etapa.
