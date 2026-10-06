# Documentação atual do CEP-FRONT

Referência Windows conferida em 06/10/2026: [contexto do instalador](CONTEXTO-INSTALADOR.md) e [auditoria 0.4.12](AUDITORIA-INSTALADOR-2026-10-06.md). As matrizes datadas de 04/10 abaixo são históricas; a auditoria separa código, draft, checks e homologação pendente.


Contexto reescrito em 04/10/2026 após revisão do código. Comece por [CONTEXTO-ATUAL](CONTEXTO-ATUAL.md), [especificação funcional](produto/especificacao-funcional.md) e [compatibilidade](compatibilidade-backend.md). README/AGENTS na raiz definem execução e limites de trabalho; a [fila central](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues) conserva objetivos e dependências.

## Fontes correntes

| Documento | Finalidade |
|---|---|
| [Contexto atual](CONTEXTO-ATUAL.md) | Funcionamento, arquitetura, sessão, escopos, bases e pendências para retomar |
| [Beta MSI 0.4.13](beta-msi-0.4.13.md) | Integração web/auditoria, pacote, GitHub sem latest, dependência do convite e aceite do piloto Windows |
| [Página de download MSI 0.4.16](download-msi-0.4.16.md) | Destino do convite na web, compatibilidade exibida e publicação separada do canal automático |
| [Mapa e limpeza do Front](mapa-front-limpeza.md) | Auditoria de código e consumidores na base de testes, mudanças isoladas e candidatos preservados |
| [Refatoração estrutural do Front](refatoracao-front.md) | Separação de responsabilidades, commits selecionáveis, checks e imagem aplicada somente nos Docker de teste |
| [Revisão para publicação web](publicacao-web-2026-10-06.md) | Integração do PR #18, revisão de segurança/deploy e distinção entre preparação e publicação efetiva |
| [Publicação web do histórico pessoal](publicacao-web-historico-2026-10-06.md) | PRs #25/#26, CI, SHA e imagem implantados, saúde pública e limite da conferência autenticada |
| [Especificação](produto/especificacao-funcional.md) | Intenção de produto, estado implementado/planejado e IDs RN/RF/CA/D |
| [Compatibilidade](compatibilidade-backend.md) | API de referência e processo de alinhamento do contrato |
| [OpenAPI real](openapi-backend-current.json) / [consumido](openapi.json) | Contrato técnico, incluindo o acompanhamento pessoal aditivo |
| [Análises e notificações — contrato](contrato-analises-notificacoes.md) | Aditivo funcional que prevalece neste recurso |
| [Análises e notificações — integração](notificacoes-implementacao.md) | Telas, Windows, persistência/recebimento e limites de evidência |
| [Histórico diário](historico-diario.md) | Dados importados, agrupamento e números autoritativos |
| [Acompanhamento pessoal](acompanhamento-pessoal.md) | Consulta atual, corte, dias de atenção, recuperação e compatibilidade |
| [Ativação de convite](contrato-ativacao-convite.md) / [reenvio](contrato-reenvio-convite.md) | Contratos, sessão e fila de e-mail |
| [Aplicativo Windows](aplicativo-windows.md) | Host, bandeja, popup, sessão, canais e verificações |
| [Menu de energia](menu-energia.md) | Decisão API, PIN, revalidação e contingência |
| [Contexto do instalador](CONTEXTO-INSTALADOR.md) / [instalador corporativo](instalador-corporativo.md) | Serviço, políticas Windows, empacotamento, bases e homologação |
| [Atualizador MSI](atualizador-msi.md) | Contrato de distribuição e implementação da branch PR #9, fora da main auditada |
| [Instalador 0.4.11](instalador-0.4.11.md) | Integração da main, recuperação durável de energia, verificação Windows, assinatura do atualizador e aceite de piloto |
| [Liberação de energia 0.4.12](liberacao-energia-0.4.12.md) | Direitos originais preservados, restauração ao fechar e migração de sessões antigas |
| [Refatoração / piloto 0.4.10](refatoracao-instalador.md) | Evidência histórica do piloto anterior; sucedido pelo pacote 0.4.11 |
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
