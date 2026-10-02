# Contexto consolidado — controle de energia e instalador do CEP Horas

Atualizado em 02/10/2026. Este documento registra a intenção de produto, o contrato entre CEP-FRONT e CEP-API, as responsabilidades do aplicativo Windows, o estado do instalador e o procedimento de implantação. Ele complementa a [especificação funcional](produto/especificacao-funcional.md), o [menu de energia](menu-energia.md) e o [instalador corporativo](instalador-corporativo.md).

## Objetivo

O CEP Horas é uma aplicação React executada no navegador e, no Windows corporativo, incorporada a um host WPF por WebView2. A implantação atual atende cerca de 30 colaboradores e a visão geral do produto considera aproximadamente 50 usuários.

Nas máquinas corporativas, o caminho normal de Desligar, Reiniciar ou Hibernar deve passar pelo CEP Horas. A API decide se a ação é permitida conforme a conciliação pessoal de horas e a tolerância configurada. Um PIN administrativo dedicado pode liberar temporariamente essas três ações para a conta autenticada.

O objetivo não é tornar fisicamente impossível desligar um computador. Administradores locais, `SYSTEM`, pressão física prolongada do botão, corte de energia, firmware, GPO de domínio e operações críticas do Windows continuam sendo caminhos de recuperação ou estão fora da garantia do aplicativo.

## Experiência esperada

1. O CEP Horas inicia com o Windows e permanece em execução; fechar a janela envia o aplicativo para a bandeja.
2. Um usuário comum não recebe a opção de encerrar definitivamente o host nem permissão para parar/configurar o serviço `CepHorasControl`.
3. Em todas as áreas autenticadas, o rodapé discreto oferece **Desligar**, **Reiniciar**, **Hibernar** e **Verificar status**.
4. Cada ação consulta a CEP API. O front não calcula tolerância nem decide por conta própria.
5. Se liberada, a ação aguarda dez segundos, mostra contagem regressiva e permite cancelamento.
6. O host WPF consulta novamente a API antes de pedir o agendamento ao serviço Windows. Uma resposta criada ou alterada pelo JavaScript não autoriza a ação.
7. O menu também aceita um PIN administrativo de seis dígitos. Quando correto, ele libera as três ações para aquele usuário por exatamente cinco minutos de tempo do servidor.
8. Mesmo durante esses cinco minutos, cada ação continua sendo verificada pela API e revalidada pelo WPF.

## Arquitetura e limites de confiança

```text
React/WebView2
  │ autenticação e chamadas permitidas
  ▼
Host WPF (CepHoras.exe)
  │ revalida sessão, origem, rota e decisão da API
  ▼
Named pipe com ACL restrita
  │ somente ação, requestId e atraso; nunca PIN ou token
  ▼
Serviço LocalSystem (CepHorasControl)
  │ agenda/cancela ação e mantém idempotência
  ▼
Windows

CEP Horas ──HTTPS──> CEP API ──> PostgreSQL
                         └── decisão, override e auditoria
```

- **CEP API:** fonte de verdade para autenticação, análise/tolerância, PIN, janela de liberação, rate limit e auditoria.
- **React:** apresenta o estado e solicita operações. Não possui bypass local, segredo administrativo nem comando direto do sistema.
- **WPF:** guarda a sessão desktop, aplica allowlist estrita, valida a origem do WebView2 e refaz a verificação da ação.
- **Serviço Windows:** recebe apenas `shutdown`, `restart`, `hibernate` ou cancelamento pelo protocolo fixo; não conhece PIN, senha de login ou token da API.
- **Instalador MSI:** instala host, serviço, início automático e políticas locais. Não contém credenciais.

## Contrato da CEP API

O contrato versionado está em [openapi-backend-current.json](openapi-backend-current.json), espelhado em [openapi.json](openapi.json), e gera `src/auth/api-schema.d.ts`.

### Verificar uma ação

`POST /api/v1/me/time-control/power-action-check`

Corpo:

```json
{ "action": "shutdown" }
```

`action` aceita somente `shutdown`, `restart` ou `hibernate`. A resposta contém `decision`, `code`, `message`, `analysis`, `override` e `unlockedUntil`. A ação só pode avançar com `decision: "allowed"` e uma resposta válida.

### Consultar o estado

`GET /api/v1/me/time-control/power-action-status?action=shutdown`

É uma consulta informativa. Ela não agenda ação e não substitui a verificação por POST feita ao clicar em uma das três ações.

### Liberar por PIN

`POST /api/v1/me/time-control/power-action-unlock`

Corpo:

```json
{ "pin": "000000" }
```

O valor acima é apenas formato ilustrativo. Nenhum PIN real pertence ao repositório. Em sucesso, a API responde:

```json
{
  "override": true,
  "unlockedUntil": "data/hora ISO-8601",
  "serverTime": "data/hora ISO-8601"
}
```

Regras:

- o PIN é dedicado ao controle de energia e não é senha de login;
- a janela pertence somente ao usuário autenticado que fez a solicitação;
- `unlockedUntil - serverTime` é exatamente cinco minutos;
- a interface deriva a contagem do relógio do servidor e de um relógio monotônico local; mudar o relógio do Windows não estende o prazo;
- durante a janela, a verificação responde `allowed`, código `administrative_override`, `override: true`, `analysis: null` e o mesmo prazo;
- expirada a janela, voltam as regras normais de conciliação;
- trocar o PIN no backend invalida liberações anteriores;
- tentativa inválida não altera nem estende uma janela que já exista.

Erros relevantes:

| HTTP | Código | Comportamento |
|---|---|---|
| 403 | `invalid_admin_pin` | Exibir erro e manter a ação bloqueada |
| 429 | `power_unlock_rate_limited` | Exibir limite de tentativas; não usar contingência |
| 503 | `power_pin_not_configured` | Informar que o PIN não foi provisionado; não usar contingência |

Qualquer resposta HTTP prova que a API respondeu. Esses erros, 401, 500, corpo inválido, falha de autenticação ou falha do serviço local nunca são tratados como API offline.

## Contingência quando a API não responde

A escolha operacional é liberar a ação somente diante de falha real de transporte até a CEP API. O fluxo é deliberadamente restrito:

1. o cliente identifica erro de conexão sem status HTTP;
2. o WPF consulta `/health/ready` de forma independente e considera a API alcançável diante de qualquer resposta HTTP, inclusive 503;
3. somente a ausência de resposta no transporte cria uma autorização candidata de contingência;
4. no agendamento, o WPF confirma novamente que a API continua inalcançável;
5. o serviço agenda a ação com os mesmos dez segundos e cancelamento.

Falha do Monday, VR Mais, banco, autenticação, bridge ou serviço Windows não equivale automaticamente a indisponibilidade de transporte da CEP API.

## Proteções aplicadas pelo instalador

O MSI corporativo por máquina:

- instala o aplicativo self-contained, o serviço `CepHorasControl` como `LocalSystem` e o início em cada logon;
- restringe `SeShutdownPrivilege` e `SeRemoteShutdownPrivilege` a `SYSTEM` e Administradores;
- ativa `HidePowerOptions` no escopo da máquina;
- desativa o desligamento na tela sem login;
- configura toque curto do botão de energia, botão de sono e fechamento da tampa como **Não fazer nada**, em AC e bateria;
- salva o estado anterior e contém ações de rollback/restauração para a remoção;
- mantém administradores e `SYSTEM` como recuperação.

O usuário comum não deve conseguir desligar pelo menu Iniciar, `Alt+F4` no desktop, tela de login, botão físico curto ou fechamento da tampa. Isso depende de instalação elevada e homologação na máquina piloto. Contas administrativas continuam capazes de recuperação e não são o modelo de uso cotidiano.

## Tratamento do PIN e dos segredos

- O front aceita exatamente seis dígitos ASCII, preserva zeros iniciais e limpa o campo antes de toda tentativa, no logout e ao desmontar o componente.
- O PIN não é salvo em React, URL, armazenamento web, sessão DPAPI, named pipe, serviço, logs, capturas, MSI, arquivo de ambiente versionado ou documentação.
- O backend armazena apenas hash forte com salt, aplica rate limit persistente e registra auditoria sem o segredo.
- O PIN de produção deve ser digitado interativamente no servidor, sem eco no terminal. Nunca deve ser passado em argumento de linha de comando.
- O ambiente local usa um PIN descartável diferente, que também não é documentado.

Comando de provisionamento, executado após a migração e a partir de `/opt/cep-api`:

```bash
sudo docker compose --env-file .env -f compose.production.yaml run --rm --no-deps migrate configure-power-pin
```

## Ordem de implantação

1. Fazer backup do PostgreSQL e atualizar a CEP API para a `main` que contém a migração `PowerActionOverrides`.
2. Executar as migrações e confirmar `/health/ready`.
3. Provisionar o PIN de produção de forma interativa, sem registrá-lo em histórico, Git ou logs.
4. Implantar o `cep-front` atualizado e validar `https://cep.lat/healthz` e o proxy de mesma origem para `/api/`.
5. Distribuir o MSI 0.4.4 em uma VM ou máquina piloto com autorização administrativa.
6. Validar login, PIN incorreto, rate limit, PIN correto, expiração em cinco minutos, as três ações, contagem de dez segundos, cancelamento, retorno às regras normais e contingência com indisponibilidade real da API.
7. Somente depois expandir para as demais máquinas.

O contêiner web não publica porta diretamente em produção. O Nginx de borda encaminha `cep.lat` ao `cep-front` e `/api/` ao contêiner independente da CEP API, conforme `deploy/README.md`.

## Ambiente local de teste

Com Docker Desktop aberto, o CEP-API pode ser iniciado no repositório irmão:

```powershell
docker compose up --build -d
```

Serviços esperados:

| Serviço | Endereço |
|---|---|
| CEP API | `http://127.0.0.1:8080` |
| Swagger | `http://127.0.0.1:8080/swagger` |
| PostgreSQL | `127.0.0.1:5432` |
| Mailpit | `http://127.0.0.1:8025` |

O front em desenvolvimento usa o proxy Vite e não requer CORS:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Após alterar a API:

```powershell
./scripts/sync-openapi.ps1 -OutputPath ./docs/openapi-backend-current.json
Copy-Item ./docs/openapi-backend-current.json ./docs/openapi.json
pnpm types:api
```

Swagger acessível não comprova banco saudável. Confirmar também `http://127.0.0.1:8080/health/ready`. Testes automatizados usam dados fictícios e executores falsos; não desligam, reiniciam ou hibernam a máquina.

## Build e validação

Comandos principais:

```powershell
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
dotnet run --project desktop/CepHoras.Desktop.Tests -c Release
dotnet run --project desktop/CepHoras.Control.Tests -c Release
dotnet run --project desktop/CepHoras.Updates.Tests -c Release
node scripts/test-desktop.mjs
./scripts/build-corporate-msi.ps1 -Version 0.4.4
```

Na entrega do PIN em 01/10/2026 passaram 83 testes unitários, 174 testes Playwright em desktop/mobile, 189 verificações .NET do desktop, 16 verificações do atualizador, testes do serviço, lint, TypeScript, builds Vite e WPF e a inspeção estrutural do MSI 0.4.1. No aditivo de recuperação, o desktop passou 200 verificações, incluindo instância única, sinalização da janela, preservação do perfil corrompido e consumo idempotente do pedido de recuperação; build Release, serviço, atualizador e inspeção estrutural do MSI 0.4.3 também passaram. Nenhuma ação real de energia foi executada.

No MSI 0.4.4, o menu da bandeja acrescenta **Fechar CEP Horas**. A janela valida localmente `ddMMyy#pec`, com zeros à esquerda e ano de dois dígitos. O valor não é enviado nem persistido. A confirmação envia ao serviço autenticado um pedido de suspensão vinculado ao SID e à sessão do processo instalado; a abertura manual envia a retomada. A senha diária não substitui o PIN de seis dígitos da API e não libera desligamento, reinício ou hibernação.

O aditivo de fechamento passou 83 testes web, 206 verificações do desktop, testes puros do serviço, 16 verificações do atualizador, builds Release e a inspeção estrutural do MSI 0.4.4. Nenhuma ação real de energia ou alteração de política foi executada.

## Recuperação da tela branca do WebView2

No MSI 0.4.3 ou posterior, uma falha de inicialização ou navegação mostra **Reiniciar CEP Horas**. O botão fecha as instâncias do CEP Horas na sessão, encerra somente os subprocessos WebView2 vinculados, preserva o perfil anterior como backup, cria um perfil limpo e reabre a janela. O `CepHorasControl` permanece ativo; nenhum serviço genérico do Windows é encerrado.

Se a recuperação automática não puder ser usada, confirme que `wwwroot/index.html` e os assets existem junto ao aplicativo e que o processo WebView2 foi iniciado. Feche o CEP Horas, preserve e renomeie o perfil:

```text
%LOCALAPPDATA%\Conceito\CepHoras\WebView2
```

Abra novamente o aplicativo para o WebView2 criar um perfil limpo. Mantenha o diretório antigo como backup até confirmar login, navegação e retomada de sessão. Esse procedimento recuperou a instalação 0.4.0 em 01/10/2026 sem reinstalar o MSI nem alterar o serviço.

## Estado versionado em 01/10/2026

| Repositório/componente | Branch/commit | Estado |
|---|---|---|
| CEP-API — PIN e override | `main` / `c0b398f` | Implementação funcional |
| CEP-API — precisão PostgreSQL | `main` / `b36c6e1` | Contrato de referência e testes aprovados |
| CEP-FRONT — instalador integrado | `codex/installer-integrado`, alinhada à `main`; base histórica `3798f2a` | MSI, bloqueio nativo, liberação administrativa e documentação consolidada |
| CEP-FRONT — liberação administrativa | `main` / `a22380c` | Front, WPF e contrato; incorporados ao MSI 0.4.3 com recuperação do WebView2 |

Em produção, a CEP API `b36c6e1`, a migração `PowerActionOverrides`, o PIN dedicado e o CEP-FRONT `a4a0a4d` foram implantados em 01/10/2026. Saúde pública e proxy responderam HTTP 200; o endpoint de liberação respondeu 401 sem autenticação. O valor do PIN não foi registrado neste documento.

O MSI 0.4.0 instalado anteriormente não possui a interface de PIN. O MSI 0.4.1 possui o PIN, mas ainda permite que o atalho abra uma segunda instância concorrente. Para usar a liberação de cinco minutos com instância única e recuperação forçada, instale o MSI 0.4.3 ou posterior. Para também usar o fechamento protegido na bandeja, instale o MSI 0.4.4 ou posterior.

## Decisões que não devem ser alteradas silenciosamente

- A API, e não o front, decide a tolerância e a permissão.
- O PIN é dedicado, globalmente administrado no backend e libera apenas o usuário autenticado por cinco minutos.
- Cada ação é revalidada mesmo durante a liberação.
- Apenas indisponibilidade real de transporte da API permite contingência.
- Toda ação liberada mantém dez segundos e opção de cancelamento.
- O serviço nunca recebe PIN ou token da API.
- Navegador comum, Debug e builds portáteis não executam ações de energia.
- Administradores/SYSTEM e desligamento físico forçado permanecem como recuperação; não são tratados como falha do produto.
