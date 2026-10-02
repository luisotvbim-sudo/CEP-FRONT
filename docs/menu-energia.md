# Menu de energia — interface e dependência nativa

Implementação iniciada na branch `codex/power-action-menu` e integrada ao MSI na branch `codex/installer-integrado`. Contrato importado integralmente de `CEP-API/codex/power-action-check`, commit `cf15a5c1365f1a240b40829a3edd2e83307939da`, arquivo `docs/openapi-current.json`. Os dois snapshots e os tipos gerados estão alinhados. A API e o PostgreSQL locais foram executados em Docker; o WPF confirmou o transporte até a API com uma conta inexistente, sem utilizar conta ou fontes reais.

## Comportamento

Aditivo de 01/10/2026: os snapshots e tipos atuais seguem a CEP API `main` `b36c6e1` (mudança funcional `c0b398f`), confirmada pela sincronização de `http://127.0.0.1:8080/swagger` após a API local ficar disponível. A implementação anterior acima é histórica. A validação usa fixtures isoladas, sem acesso ao PIN provisionado localmente e sem deploy de backend em produção.

Todas as áreas autenticadas têm um menu recolhível no final da página, fora do conteúdo e sem posição flutuante: Desligar, Reiniciar, Hibernar e Verificar status. Inclui SystemAdmin sem organização selecionada e nas páginas globais. Login, prévia de desenvolvimento e download público não recebem o menu. Usa teclado nativo de `details/summary`, foco visível, botões com rótulos, região de avisos e quebra de linha em janelas pequenas.

As ações consultam `POST /api/v1/me/time-control/power-action-check` com a ação escolhida. Status consulta somente `GET /api/v1/me/time-control/power-action-status?action=shutdown`. Nenhuma rota leva `organizationId`, pessoa ou período; a consulta sempre corresponde ao usuário autenticado. A autorização continua no servidor. As allowlists HTTP e WPF incluem apenas os métodos reais.

O front valida a resposta e usa `decision`, sem calcular diferença ou tolerância. `blocked` e `indeterminate` mostram a mensagem e impedem agendamento. Status mostra decisão, mensagem e tolerância quando a análise existe, sem iniciar ação. Erros HTTP e respostas inválidas também impedem agendamento. No navegador, uma decisão `allowed` informa que a execução depende do aplicativo Windows.

## Liberação temporária por PIN

O menu oferece um campo de senha com teclado numérico, autocomplete desativado, exatamente seis dígitos ASCII e botão **Liberar por 5 minutos**. Zeros iniciais são preservados. O PIN é administrativo e dedicado, diferente da senha de login; a liberação vale apenas para a conta autenticada. Não há provisionamento ou seleção de outra pessoa nesta interface.

O cliente envia somente `{ pin }` no corpo de `POST /api/v1/me/time-control/power-action-unlock`. O campo é limpo antes de qualquer tentativa, inclusive formato inválido, e na desmontagem/logout. O PIN não fica em estado React, URL, armazenamento do navegador, arquivo de sessão DPAPI, logs, pacote MSI ou serviço Windows.

A resposta deve conter `override: true`, `serverTime` e `unlockedUntil` com diferença exata de cinco minutos. O prazo visível usa esses horários e `performance.now()`, descontando conservadoramente o tempo da requisição; ajustes no relógio local não prorrogam a janela. A contagem é informativa: Desligar, Reiniciar e Hibernar sempre consultam o POST de verificação, e o WPF refaz a consulta antes de agendar no serviço. Durante a liberação, a API retorna `allowed`, `administrative_override`, `override: true`, prazo válido e `analysis: null`. Respostas normais exigem `override: false` e `unlockedUntil: null`.

Verificar status continua sendo apenas GET. Uma resposta normal encerra a indicação de liberação. Sem o `serverTime` da tentativa original, uma liberação encontrada em status mostra o horário informado pelo servidor, sem inventar outra janela de cinco minutos. Ao expirar, a contagem e a indicação local são removidas; uma ação posterior precisa de nova decisão da API. Logout remove a indicação local; novo login não reinicia o prazo mantido pelo backend.

403 (`invalid_admin_pin`), 429 (`power_unlock_rate_limited`) e 503 (`power_pin_not_configured`) mostram erro objetivo, limpam o campo e nunca entram em contingência. Uma tentativa inválida não altera o prazo anterior. Não há bypass local por PIN, nem PIN no named pipe; o serviço recebe somente os pedidos fixos de ação/cancelamento. A allowlist WPF aceita somente POST no caminho exato de liberação, sem query string.

Ativação em produção depende de deploy autorizado do backend, migração `PowerActionOverrides` e provisionamento seguro do PIN dedicado. Esta entrega não executa essas operações nem publica segredos. O MSI 0.4.1 foi construído e inspecionado sem instalação; testes usam credenciais fictícias e não desligam, reiniciam ou hibernam a máquina.

## Contrato implementado no instalador/bridge WPF

Na instalação corporativa, o host anuncia `window.__CEP_POWER_VERSION__ = 1`, revalida a decisão no backend e conversa por named pipe com o serviço `CepHorasControl`. React não recebe senha, token ou comando do sistema. Builds portáteis, Debug e navegador comum não anunciam suporte e nunca executam uma ação local.

O host anuncia `window.__CEP_POWER_VERSION__ = 1` somente na instalação corporativa, onde todos os métodos abaixo estão implementados, preservando `window.__CEP_DESKTOP__` e `window.chrome.webview`. O adaptador envia:

```json
{
  "id": "UUID de correlação",
  "type": "cep-power",
  "operation": "schedule",
  "payload": {
    "requestId": "UUID idempotente do agendamento",
    "action": "shutdown",
    "delaySeconds": 10,
    "authorization": { "kind": "api", "check": "PowerActionCheckResponse completo" }
  }
}
```

`authorization.check` no exemplo representa um objeto, não uma string. Resposta no canal WebView: `{ id, ok: true, result: { requestId, action, executeAt } }`, com `executeAt` ISO UTC real, dez segundos após o agendamento no host. A interface mostra a diferença entre esse horário e o relógio atual, inclusive após perda de foco; não envia um comando de execução ao chegar a zero. O host é o dono do agendamento.

- **`schedule`:** validar origem virtual, sessão/conta, ação e prazo; usar serviço/bridge do instalador. A resposta da API enviada pelo renderer não é uma credencial: vincular a decisão recente ao usuário no host ou refazer a verificação autenticada no host. Não aceitar uma decisão inventada pelo JavaScript. `requestId` é idempotente e não deve agendar duas vezes.
- **`cancel`:** payload `{ requestId }`; responder `{ cancelled: true }` somente após abortar de fato. Cancelamento idempotente deve também registrar uma intenção de aborto para impedir um agendamento tardio com o mesmo ID. Se o cancelamento falhar, a interface mantém o botão para repetir e bloqueia novas ações.
- **`verify-api-unreachable`:** payload vazio; responder `{ unreachable: true }` exclusivamente quando a CEP API realmente não responder no transporte. Qualquer resposta HTTP, inclusive 400/401/403/429/500/503, significa que a API respondeu. Falha de fonte externa, resposta inválida, timeout do bridge, autenticação e indisponibilidade do serviço Windows não são API offline. Ao receber `{ kind: "api-unreachable" }` em `schedule`, o host precisa revalidar essa condição por conta própria.
- **Erros:** `{ id, ok: false, error: { code, correlationId? } }`. Nenhum token, senha ou comando do sistema atravessa o renderer. O timeout do protocolo é cinco segundos. Em agendamento inválido, falho ou sem confirmação, o adaptador tenta abortar pelo `requestId`; se o aborto também for incerto, preserva o ID e oferece nova tentativa de cancelamento.

A interface só solicita a verificação de contingência após `AuthError` com `connection_failed` e sem status HTTP, status 0, ou o 503 sintético de transporte explicitamente marcado pelo host com `transportFailure: true`. O marcador não vem do corpo da API. Respostas HTTP 503 e falhas no corpo após receber headers não são transporte offline. **Esse candidato não libera nada:** o host consulta `/health/ready` com prazo curto e considera a API alcançável diante de qualquer resposta HTTP, inclusive 503. Somente falha de transporte confirmada libera a contingência, que é revalidada novamente no agendamento.

Ao sair da conta, a interface e o host solicitam cancelamento. O serviço mantém idempotência por `requestId`, restringe ações à lista fixa e aceita pedidos somente do `CepHoras.exe` instalado. Desligamento/reinício usam o agendamento do Windows; hibernação usa temporizador cancelável no serviço. A execução/cancelamento reais das três ações ainda exigem homologação da TI. Nenhuma ação Windows real foi executada nos testes automatizados.

## Validação

Validação do aditivo de PIN em 01/10/2026: 83 testes unitários, 174 Playwright (desktop/mobile), 189 checks .NET, 16 checks do atualizador, testes puros do serviço, lint, TypeScript, builds Vite e WPF Debug/Release. A regressão com WPF/WebView2 real passou contra API descartável, cobrindo sessão, refresh, DPAPI, allowlist, isolamento de tokens e logout. O MSI 0.4.1 passou na inspeção estrutural, sem instalação. Casos novos cobrem PIN correto/com zero inicial, formato inválido, 403/429/503, expiração exata de cinco minutos, relógio local incorreto, tentativa inválida sem extensão, logout, não persistência, revalidação das três ações no host e resposta HTTP cujo corpo falha. Os resultados abaixo são da entrega anterior.

Testes unitários cobrem rotas, resposta inválida, decisões, limite de tolerância sem recálculo, contingência, protocolo, cancelamento e agendamento incerto. Playwright usa API e bridge simulados: perfis autenticados, páginas públicas, status, bloqueio/inconclusivo, falha técnica, navegador, teclado/acessibilidade, janela pequena, contagem de dez segundos, cancelamento, recuperação de falha no aborto e confirmação nativa de contingência. Testes .NET verificam as novas rotas e métodos na allowlist. As funcionalidades existentes são verificadas pela suíte de regressão.

Resultados desta entrega: 69 testes unitários (19 novos), 158 testes Playwright (34 novos, desktop e mobile), 158 checks .NET de segurança/armazenamento, 16 checks do atualizador, testes puros do serviço, lint completo, TypeScript, build Vite e WPF/WebView2 real sem erros. O MSI passou por inspeção estrutural sem instalação: escopo por máquina, serviço LocalSystem, ações elevadas e adiadas, rollback/restauração, ACL e payload. Nenhuma política ou ação Windows real foi executada. Capturas com dados fictícios foram revisadas em `.local/power-menu-desktop.png` e `.local/power-menu-mobile.png`.
