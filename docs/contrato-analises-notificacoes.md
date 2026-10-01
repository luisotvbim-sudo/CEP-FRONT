# Solicitação ao frontend — análises e notificações

Atualizado em 29/09/2026. Requisitos aprovados e integrados ao contrato real desta entrega. Consulte [implementação e limites de homologação](notificacoes-implementacao.md). A publicação de backend, frontend e executável é independente do código local.

Fonte canônica: `CEP-API/docs/conciliacao-horas/contrato-analises-notificacoes.md`, no repositório irmão. Esse aditivo prevalece sobre a especificação anterior nestes assuntos. Consultar a versão correspondente na mesma entrega; não presumir que o arquivo local já esteja publicado no GitHub.

## Regras para as telas

- Configurações são globais, alteráveis por todo administrador autorizado à tela, não exclusivas do SystemAdmin. Dados e destinatários continuam limitados pelo backend ao escopo organizacional autorizado.
- Tolerância diária em minutos; agendas com horário e mensagem, criação, edição, ativação/desativação e exclusão auditada.
- Horário de negócio: São Paulo. Avisos iniciais: 10h para pendências de ontem, 11h50 e 17h para conferência parcial do expediente e lembretes correspondentes. Virada do dia gera relatório de batidas ímpares e cronômetros ainda abertos; diferenças são avaliadas quando calculáveis.
- O aviso das 10h considera somente o dia civil anterior, nunca pendências antigas ou o último dia útil (segunda-feira considera domingo). Não há jornadas após meia-noite. Avisos automáticos não são enviados aos sábados e domingos nem acumulados para segunda-feira; processamento diário e recuperação de notificações já pendentes continuam. Feriados e eventual bloqueio de envio manual no fim de semana ainda precisam de confirmação.
- Envio instantâneo para um usuário ou todos do escopo, com mensagem e análise individual: Diário, Semanal ou Sprint.
- Diário = hoje até o envio; Semanal = segunda-feira até o envio; Sprint = dias 1–14 ou 15–último dia do mês até o envio. Dia 22 começa no dia 15. Fevereiro usa seu último dia real. Período/corte vêm da API.
- Um único motor no backend fornece todas as análises. React/WPF não calculam saldos, tolerâncias, períodos oficiais ou destinatários. Exibir valores/qualidade retornados; desconhecido não vira zero, dia atual não vira fechamento definitivo.

## Telas a entregar

1. **Configurações globais:** tolerância, fuso, alcance global, autoria e conflito de edição.
2. **Agendamentos:** lista, horário, mensagem, finalidade da regra, ativar/desativar, criar/editar/excluir; salvar não significa notificar.
3. **Enviar agora:** usuário/todos do escopo, mensagem, Diário/Semanal/Sprint, período/corte, prévia e quantidade antes de confirmar; progresso, sucesso parcial e erros.
4. **Central de notificações:** próprias, não lidas/histórico, mensagem, análise anexada e abertura do detalhe; ler não resolve pendência.
5. **Minha análise:** totais VR/Monday, diferença, tolerância, corte, atualização/qualidade das fontes, detalhe por dia e evidências; parcial claramente identificado.
6. **Relatórios de erros:** filtros por dia/pessoa/tipo, batidas ímpares, cronômetros abertos no fechamento e diferenças confirmadas, reanálises e escopo de gestão.
7. **Histórico de envios:** autor, período, destinatários e estados reais de processamento, entrega e leitura.

Seguir os critérios detalhados do documento canônico. Manter design existente, acessibilidade, estados vazios, carregamento, falha de fonte, falta de associação, sessão expirada, sem permissão e concorrência. Preservar funcionalidades existentes.

## Dependências e desktop

Os snapshots OpenAPI foram atualizados da API real desta entrega; os tipos gerados e o cliente consomem configurações globais, agendas, prévia e fila de envios, central pessoal e análises persistidas. Backend deve ser publicado antes deste frontend. A antiga proposta de agendas por organização foi substituída pelo alcance global. Justificativas/aprovações e exportações continuam fora desta entrega.

No Windows: iniciar com o sistema, bandeja, avisos nativos autenticados e abertura da mesma notificação da central; nenhuma regra de cálculo ou distribuição local. Ajustar allowlist apenas com as rotas reais e preservar tokens no host/DPAPI. Por decisão de produto de 30/09/2026, o instalador corporativo bloqueia para o usuário comum as rotas normais de desligamento, reinício, suspensão, hibernação e encerramento da sessão. O menu autenticado consulta a CEP API; somente `allowed` agenda a ação no serviço local. Se a API realmente não responder no transporte, o host confirma a indisponibilidade e permite a contingência. `blocked`, `indeterminate` e qualquer resposta HTTP não são contingência offline.

PC desligado/offline — decisão aprovada: ao iniciar a sessão do Windows, abrir automaticamente o aplicativo, restaurar a autenticação e buscar todas as notificações pendentes do usuário, percorrendo todas as páginas. Se necessário, pedir login; sem rede, retomar ao reconectar. Não descartar avisos antigos, inclusive lembretes. Exibir horário original e análise do período original, identificando atraso, sem apresentá-los como conferência atual. Sincronizar não marca leitura. Deduplicar pelo identificador persistente para evitar avisos repetidos a cada reinício; manter não lidas na central e confirmar recebimento apenas após registro local bem-sucedido. Testar múltiplas páginas, reinício, sessão expirada e queda de conexão durante a recuperação.

Tolerância inicial aprovada: 30 minutos diários nos dois sentidos, editável globalmente. Automação inicia desativada e exige ativação explícita nas configurações. Não há envio automático em fins de semana; feriados/férias/escalas especiais não possuem calendário configurado nesta entrega. As agendas têm finalidade explícita. Fonte incompleta não gera afirmação de horas corretas.

Proteção contra excesso: um aviso consolidado por usuário/execução; chave de idempotência no envio manual; deduplicação persistida no backend e no Windows; recuperação de todo o lote antes da confirmação; um resumo nativo por lote com intervalo mínimo de cinco minutos entre popups. A central preserva cada mensagem, sem marcar leitura automaticamente. A homologação operacional deve validar fontes reais e políticas de notificação de cada estação.
