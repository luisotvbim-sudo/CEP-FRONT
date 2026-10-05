# Documentação atual do CEP-FRONT

Contexto reescrito em 04/10/2026 após revisão do código. Comece por [CONTEXTO-ATUAL](CONTEXTO-ATUAL.md), [especificação funcional](produto/especificacao-funcional.md) e [compatibilidade](compatibilidade-backend.md). README/AGENTS na raiz definem execução e limites de trabalho; a [fila central](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues) conserva objetivos e dependências.

## Fontes correntes

| Documento | Finalidade |
|---|---|
| [Contexto atual](CONTEXTO-ATUAL.md) | Funcionamento, arquitetura, sessão, escopos, bases e pendências para retomar |
| [Especificação](produto/especificacao-funcional.md) | Intenção de produto, estado implementado/planejado e IDs RN/RF/CA/D |
| [Compatibilidade](compatibilidade-backend.md) | API de referência e processo de alinhamento do contrato |
| [OpenAPI real](openapi-backend-current.json) / [consumido](openapi.json) | Contrato técnico; 52 paths/72 schemas na referência auditada |
| [Análises e notificações — contrato](contrato-analises-notificacoes.md) | Aditivo funcional que prevalece neste recurso |
| [Análises e notificações — integração](notificacoes-implementacao.md) | Telas, Windows, persistência/recebimento e limites de evidência |
| [Histórico diário](historico-diario.md) | Dados importados, agrupamento e números autoritativos |
| [Ativação de convite](contrato-ativacao-convite.md) / [reenvio](contrato-reenvio-convite.md) | Contratos, sessão e fila de e-mail |
| [Aplicativo Windows](aplicativo-windows.md) | Host, bandeja, popup, sessão, canais e verificações |
| [Menu de energia](menu-energia.md) | Decisão API, PIN, revalidação e contingência |
| [Contexto do instalador](CONTEXTO-INSTALADOR.md) / [instalador corporativo](instalador-corporativo.md) | Serviço, políticas Windows, empacotamento, bases e homologação |
| [Atualizador MSI](atualizador-msi.md) | Contrato de distribuição e implementação da branch PR #9, fora da main auditada |
| [Deploy web](../deploy/README.md) | Contêiner, proxy de borda e operação do front web |

O guia de atualização MSI descreve a branch correspondente do [PR #9](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/9); sua presença documental não integra esse código à main. A tabela de bases no [README](../README.md) impede confundir recursos de 0.4.7–0.4.9 com a `main` auditada, que contém MSI 0.4.3. Não há release MSI estável/homologação completa comprovada nesta revisão.

## Documentos substituídos nesta limpeza

Conteúdo necessário foi absorvido nas fontes correntes; a narrativa histórica está preservada no Git, antes desta reescrita, base `eb63dbd`. Arquivos removidos não são instruções de retomada.

| Arquivo removido | Sucessor e conhecimento conservado |
|---|---|
| `briefing-consulta-inicial.md` | Contexto/especificação: formatação, nulabilidade, acessibilidade e segurança; abandonada a proposta anônima de funcionário fixo/cache |
| `plano-trabalho-cep-front.md` | Contexto/compatibilidade/especificação: escopos, 7/90 dias, associação, requisitos e homologação pendentes |
| `desktop-handoff.md` | Aplicativo Windows/contexto: execução, DPAPI, distribuição/canais e retomada por GitHub |
| `refatoracao.md` | Contexto: responsabilidades compartilhadas, descarte de respostas, paginação, agrupamento e fronteiras de transporte |
| `previa-analises-notificacoes.md` | README/contexto: prévia DEV/fixtures isoladas, ausência de API/storage/envios e limites de validação |
| `contexto-controle-energia-instalador.md` | Contexto do instalador/menu de energia: contratos, segurança, bases e homologação, sem relatos antigos de publicação |

`contexto-atualizador-msi.md`, nas branches em que existia, foi absorvido por contexto do instalador/guia do atualizador; a branch documental correspondente conserva a rastreabilidade no Git.

Prompts de programação e matrizes antigas contraditórias foram retirados dos documentos correntes. IDs e requisitos de produto ainda úteis foram conservados, com status explícito. Um teste relatado no passado não é um teste executado agora; cada entrega registra base, comando e resultado efetivos.
