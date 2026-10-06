# Desktop TESTE MOCK

Extensão do [ambiente portátil TESTE](desktop-ambiente-teste.md), sobre a base `d9656ffbe5c28b6131b509cf0758f33c9c336676`, no mesmo worktree isolado e branch `codex/desktop-test-environment`. Não integra a PR #16 nem instala MSI/serviço/políticas. Consulte também os guias `AMBIENTE-CENARIOS-MOCK.md` e `CENARIOS-ANALISE-MOCK.md` do CEP-ORQUESTRADOR.

## Abrir

No worktree `C:\Users\luizi\.codex\worktrees\desktop-test-environment\CEP-FRONT`:

```powershell
./scripts/start-desktop-test.ps1 -Environment Mock -Build -CheckOnly
./scripts/start-desktop-test.ps1 -Environment Mock
```

O launcher aceita somente `Real` e `Mock`, sem parâmetro de URL arbitrária. `Real` continua apontando para `http://127.0.0.1:8080`; `Mock` usa exclusivamente `https://localhost:9443`. TLS mantém validação normal no PowerShell, .NET e WebView2. Sem alteração de certificado/autoridade global, CORS, allowlist ou políticas Windows.

O proxy mock encaminha `/api/` à API Docker interna. `/health/ready` desse proxy retorna o Front, portanto o launcher verifica o endpoint protegido `/api/v1/me`: exige 401 com desafio Bearer, sem autenticar ou gerar sessão. Esse resultado identifica o transporte/rota; não certifica banco, fontes ou worker.

| Ambiente | Estado nativo | Payload privado |
|---|---|---|
| TESTE real 8080 | `%LOCALAPPDATA%\Conceito\CepHoras-Test` | `.local/desktop-environment/payload` |
| TESTE MOCK 9443 | `%LOCALAPPDATA%\Conceito\CepHoras-Mock-Test` | `.local/desktop-mock-environment/payload` |

Cada raiz tem `Sessions`, ledger de recebimentos/diagnósticos e `WebView2`; mutex derivado da sessão. O host recusa misturar destino e diretórios. Refresh permanece DPAPI CurrentUser e access token em memória nativa. React recebe somente metadados/resultados. Configuração e registro do processo são privados/ignorados em `.local`; não empacotar perfis ou credenciais.

## Conta demo e notificações

A janela mostra **TESTE MOCK · https://localhost:9443 · energia simulada**. Faça login manual com a senha já definida para a conta demonstrativa. Essa senha não foi alterada nem testada pelo driver. Nenhum convite é consumido. A fixture automática usa somente as contas fictícias `member.a` e `coordinator.a`.

Depois do login/retomada, o host busca todas as páginas pendentes e confirma recebimento somente após ledger DPAPI; repete a consulta a cada minuto. O resumo nativo agrupa avisos e é limitado a um popup por cinco minutos. Recebimento não marca leitura. Abra **Minhas notificações**; **Marcar como lida** é ação explícita por aviso. Expandir **Ver análise anexada** preserva a leitura e o corte do snapshot.

Na demo, os dois snapshots Sprint e suas notificações pertencem ao clone. A leitura de análises não reprocessa fontes. Após corrigir fontes, o snapshot anterior permanece; novo pedido administrativo gera outro. Consultas/recebimentos da fixture não alteram as notificações demo.

## Energia simulada

A API calcula `allowed`, `blocked` ou `indeterminate` com as fontes mock. O WPF reconsulta a decisão ao agendar e recusa permissão fabricada pelo renderer. Quando permitido, somente `SimulatedPowerBroker` em memória recebe a ação: dez segundos, status e cancelamento; nenhuma chamada Windows ou IPC com o CEP instalado. Ao fim da contagem, o computador continua ligado. Nenhum PIN é provisionado ou registrado por este fluxo.

O cenário corrente pode impedir desligamento por dados incompletos; isso deve aparecer como decisão da API, não como contingência offline. A simulação não transforma decisão negativa em permissão.

## Driver de fixture

Feche o desktop mock e saia da conta antes de executar. O driver recusa sessão salva por padrão para evitar retomar a demo. Usa a senha privada já autorizada, sem copiar seu conteúdo para código/logs:

```powershell
node --use-system-ca scripts/test-desktop-mock.mjs `
  --password-file=C:/Users/luizi/source/repos/CEP-ORQUESTRADOR/.local/mock-stack/test-password `
  --scenarios-file=C:/Users/luizi/source/repos/CEP-ORQUESTRADOR/.local/mock-stack/scenarios.json `
  --identities-file=C:/Users/luizi/source/repos/CEP-ORQUESTRADOR/.local/mock-stack/identities.private.json
```

Node usa as autoridades já confiáveis do Windows; não ignora erros HTTPS. O driver cria um aviso novo somente para a fixture, aguarda worker e polling nativo, verifica recebimento sem leitura, reinicia/retoma sessão DPAPI, verifica deduplicação e clica explicitamente em **Marcar como lida** apenas nesse aviso. O coordenador do harness mantém sua sessão temporária em memória fora do renderer e a revoga ao terminar.

Com os dois arquivos de fontes fornecidos, o driver altera temporariamente somente os overrides Monday/VR de `member.a` para os três resultados de energia, sem reimportar ou mudar os snapshots demo. Restaura esses overrides ao final e conserva os demais; alteração concorrente da fixture impede sobrescrita. Sem esses parâmetros, verifica somente a decisão corrente. Não executar reset geral para testar o desktop.

O driver usa CDP loopback temporário e encerra seu processo. Reabrir pelo launcher remove argumentos de depuração e deixa a tela de login pronta para o usuário. `.local` e os arquivos privados do mock permanecem fora do Git. Nenhuma produção, merge, release, instalação ou VM pertence a esta entrega.

## Evidência de 05/10/2026

- Configuração/host/guard: commit `794764e`; driver de validação: `a99be57`. Commits separados da documentação, destinados somente ao ambiente TESTE.
- API `cep-mock-api:local`, revisão da imagem `a2715de426ff74e9374373a95ee3c9e55e12a4ad`. HTTPS validado sem bypass; autenticação nativa da fixture e rota protegida confirmadas. O Front WPF usa assets locais deste build e transporta operações pelo host para `/api/v1` do proxy 9443.
- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, publish Debug mock e build Release: passaram. Suíte `CepHoras.Desktop.Tests` Debug/Release passou, incluindo destinos fixos, rejeição de mistura API/sessão e simulador.
- Driver WPF/WebView2 com API Docker mock: login fixture, metadados sem tokens, aviso processado pelo worker, recebimento por polling periódico, ledger persistido, não lida até clique, popup reportado pelo Windows, retomada DPAPI e ausência de popup duplicado passaram.
- Leitura foi acionada explicitamente no botão da notificação recém-criada da fixture. Nenhuma autenticação, recebimento ou leitura da conta demo foi executada pelo teste.
- Decisão corrente da fixture: `allowed`/`within_tolerance`. Overrides temporários exclusivos dessa fixture produziram `allowed`, `blocked` e `indeterminate`; host revalidou, simulou/cancelou o permitido e recusou os dois negativos mesmo recebendo um check falsificado pelo renderer. Fontes restauradas e decisão corrente conferida novamente; sem importação, mudança de snapshots demo, agenda ou PIN.
- Operacional reaberto pelo launcher: PID observado `55784`, título/rodapé TESTE MOCK com destino HTTPS9443, diagnóstico `ready`, tela de login conferida visualmente e nenhum arquivo de token de sessão salvo após logout da fixture. Não há CDP na configuração operacional.
- `cep-test` permaneceu ativo; checkout principal continua `9e621d0` sem alteração local. Nenhum serviço, MSI instalado, política Windows, rede Compose, volume ou credencial foi alterado por esta entrega.

Limites: essas evidências validam integração nativa e fontes controladas. Conta demo aguarda login manual com sua senha existente; entrega externa de e-mail, fontes reais, instalação/upgrade MSI, Windows elevado, VM e desligamento/reinício/hibernação reais não foram homologados. A simulação passou por agendamento e cancelamento; não afirma execução de energia no Windows.
