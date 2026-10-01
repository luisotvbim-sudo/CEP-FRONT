# Menu de energia — interface e dependência nativa

Implementação na branch `codex/power-action-menu`, sobre `main` (`076779c`). Contrato importado integralmente de `CEP-API/codex/power-action-check`, commit `cf15a5c1365f1a240b40829a3edd2e83307939da`, arquivo `docs/openapi-current.json`. A API local estava desligada durante esta integração. Os dois snapshots e os tipos gerados estão alinhados; não houve validação de fontes ou contas reais.

## Comportamento

Todas as áreas autenticadas têm um menu recolhível no final da página, fora do conteúdo e sem posição flutuante: Desligar, Reiniciar, Hibernar e Verificar status. Inclui SystemAdmin sem organização selecionada e nas páginas globais. Login, prévia de desenvolvimento e download público não recebem o menu. Usa teclado nativo de `details/summary`, foco visível, botões com rótulos, região de avisos e quebra de linha em janelas pequenas.

As ações consultam `POST /api/v1/me/time-control/power-action-check` com a ação escolhida. Status consulta somente `GET /api/v1/me/time-control/power-action-status?action=shutdown`. Nenhuma rota leva `organizationId`, pessoa ou período; a consulta sempre corresponde ao usuário autenticado. A autorização continua no servidor. As allowlists HTTP e WPF incluem apenas os métodos reais.

O front valida a resposta e usa `decision`, sem calcular diferença ou tolerância. `blocked` e `indeterminate` mostram a mensagem e impedem agendamento. Status mostra decisão, mensagem e tolerância quando a análise existe, sem iniciar ação. Erros HTTP e respostas inválidas também impedem agendamento. No navegador, uma decisão `allowed` informa que a execução depende do aplicativo Windows.

## Contrato proposto para o instalador/bridge WPF — ainda pendente

Não existe execução nativa de energia nesta branch. O host atual ignora `cep-power` e não anuncia suporte; a interface informa a dependência em vez de iniciar uma contagem fictícia. Este é um contrato local de integração proposto, não uma nova rota da CEP API. Não inclui serviço, política Windows, senha ou comando de sistema no React.

O host deve anunciar `window.__CEP_POWER_VERSION__ = 1` somente quando todos os métodos abaixo estiverem implementados, preservando `window.__CEP_DESKTOP__` e `window.chrome.webview`. O adaptador envia:

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

A interface só solicita a verificação de contingência após `AuthError` com `connection_failed` e sem status HTTP, status 0, ou o 503 sintético de transporte usado pelo desktop. **Esse candidato não libera nada:** o método nativo deve distinguir uma resposta HTTP 503 real de uma falha de transporte. O `ApiSession` atual ainda mapeia exceções de transporte do pedido de energia para erro genérico; o integrador deve classificar essas falhas estritamente no host para habilitar esse caminho. Não converter `desktop_request_failed` em offline.

Ao sair da conta, a interface solicita cancelamento em desmontagem. O host também deve abortar autonomamente ao encerrar/recarregar a WebView, trocar de conta ou perder a sessão, e garantir que a perda de uma confirmação não deixe uma ação órfã. Essas garantias e a execução/cancelamento efetivos das três ações precisam de homologação com o instalador. Nenhuma ação Windows real foi executada nos testes desta branch.

## Validação

Testes unitários cobrem rotas, resposta inválida, decisões, limite de tolerância sem recálculo, contingência, protocolo, cancelamento e agendamento incerto. Playwright usa API e bridge simulados: perfis autenticados, páginas públicas, status, bloqueio/inconclusivo, falha técnica, navegador, teclado/acessibilidade, janela pequena, contagem de dez segundos, cancelamento, recuperação de falha no aborto e confirmação nativa de contingência. Testes .NET verificam as novas rotas e métodos na allowlist. As funcionalidades existentes são verificadas pela suíte de regressão.

Resultados desta entrega: 69 testes unitários (19 novos), 158 testes Playwright (34 novos, desktop e mobile), 158 checks .NET de segurança/armazenamento, lint completo, TypeScript, build Vite e build WPF Debug sem erros. `git diff --check` limpo. Capturas com dados fictícios revisadas em `.local/power-menu-desktop.png` e `.local/power-menu-mobile.png`; os testes também verificam que o menu não sobrepõe o conteúdo nem aumenta a largura da página.
