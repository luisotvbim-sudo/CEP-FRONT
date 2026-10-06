# Análises e notificações — integração atual

Contexto revisto em 04/10/2026. Código auditado: Front `eb63dbd`, API `b36c6e1`. Regras aprovadas em [contrato funcional](contrato-analises-notificacoes.md); visão e pendências em [especificação](produto/especificacao-funcional.md). Snapshots e tipos já incluem as operações deste recurso. Esta revisão não executou testes, envio ou homologação de produção.

## Interface autenticada

- Membro/Líder usam sino no cabeçalho em lugar do item lateral: contagem pelo `total` de `GET /me/notifications?unreadOnly=true`, consulta a cada minuto e ao abrir. Dropdown reutiliza a central com filtro, páginas de 20, mensagens completas, análise expansível e leitura explícita; leitura atualiza a contagem. Escape devolve foco ao sino; clique fora/saída do foco fecha. “Ver todas as notificações” e intenção nativa abrem a central completa. Nenhum novo contrato ou ACK de recebimento no React; administrador mantém navegação existente.

- Coordenadores e `SystemAdmin` editam tolerância/automação e agendas **globais** com horário, finalidade, mensagem e versão. Conflito exige atualizar o registro; a tela informa o alcance de todas as organizações. Salvar não significa disparar.
- Envio manual administra uma pessoa associada à conta ou todos os destinatários elegíveis da organização. Prévia resolve quantidade, datas e corte no servidor; o processamento terá seu próprio corte. Editar destinatário/mensagem/período invalida a confirmação.
- `requestId` é conservado após resposta incerta; repetir a mesma solicitação usa a mesma identidade, sem criar envio silencioso extra. O servidor revalida autorização e conteúdo e aplica seus limites de frequência.
- Histórico de envios distingue pedido em fila do processamento. Não comprova popup/recebimento/leitura. A central permite marcar cada mensagem lida explicitamente; abrir detalhe não marca leitura nem corrige horas.
- Análises mostram totais/diferenças/dias/problemas/fontes da API. **GET analyses lista snapshots persistidos**; atualizar consulta não importa/reanalisa fontes. Relatórios conservam corte e versão originais, mesmo que o histórico bruto mude.
- `SystemAdmin` abre configurações globais e central própria sem organização; pessoas/envio/relatórios exigem `organizationId` selecionado. Caixa pessoal não se transforma na caixa de outra organização.
- Membro recebe análises próprias; Líder recebe seu escopo atual. Falta de vínculo, identidade ou resultado não equivale a zero horas/coerência.

O frontend não calcula período, tolerância ou destinatários. Total agregado nulo não vira subtotal válido. Dia corrente/qualidade incompleta e valores desconhecidos são mostrados como recebidos. Calendário, casos/justificativas/aprovações e exportação continuam planejados.

## Recebimento Windows

`NotificationDelivery` consulta pendentes depois do login/retomada e a cada minuto. Recupera todas as páginas antes de confirmar, evitando que confirmação desloque a paginação. Inclui mensagens antigas já geradas enquanto o PC esteve desligado; não reconstrói execuções que o servidor nunca gerou.

IDs recebidos são gravados com DPAPI por conta e origem API antes de `POST /me/notifications/received`, em lotes de até 100 IDs. O ledger contém IDs, sem tokens/corpos de mensagem; não é cache offline de análises. Falha na consulta, gravação ou confirmação preserva a possibilidade de retentativa no ciclo seguinte.

Um popup nativo de bandeja resume o lote, com intervalo mínimo de cinco minutos entre resumos. A central conserva as mensagens e datas originais; receber não marca leitura. Não perturbe/políticas Windows podem suprimir exibição; popup solicitado não prova leitura. Clicar no resumo abre a mesma central autenticada. O teste de popup é identificado e não envia mensagem ao backend.

Sem rede na inicialização, o arquivo de sessão é preservado para retomada. Resposta incerta na rotação de refresh exige login, sem replay. Tokens permanecem no host; notificações não concedem acesso a dados cujo escopo foi revogado. Inicialização/bandeja/fechamento variam por instalação: [aplicativo Windows](aplicativo-windows.md).

## Fontes, agenda e evidência

Tolerância inicial: 30 minutos nos dois sentidos, limite exato permitido. Automação nasce desativada. Agendas 10h/11h50/17h têm finalidade explícita, excluem sábado/domingo; relatório diário continua. Feriados/férias/escalas não têm calendário completo. O worker recupera slots do mesmo dia, com corte original; não recompõe dias passados nunca enfileirados.

O [contrato](contrato-analises-notificacoes.md) detalha períodos, integridade e limites. Testes existentes de browser/contrato/nativo usam dados fictícios e API descartável. Para alteração funcional, verificar versão/conflito global, escopo, idempotência/resposta incerta, valores nulos, leitura explícita, todas as páginas antes de ACK, reinício e isolamento DPAPI. Homologação exige Monday/VR reais, perfis autorizados e políticas de notificação/instalação em Windows. CI não substitui essa evidência.
