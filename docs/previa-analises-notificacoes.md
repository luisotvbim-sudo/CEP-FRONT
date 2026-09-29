# Prévia de análises e notificações

Implementação visual em 29/09/2026, baseada em `contrato-analises-notificacoes.md`. Não é integração HTTP nem entrega de notificações.

## Abrir

Execute `pnpm dev` e acesse `http://127.0.0.1:5173/?preview=analysis`.

A prévia só existe no modo de desenvolvimento. O import dinâmico condicionado a `import.meta.env.DEV` exclui o módulo, estilos e exemplos do build de produção. A URL sem o parâmetro continua abrindo a aplicação normal. Não há login de demonstração dentro do fluxo real, chamada de API, gravação em storage ou alteração de sessão na prévia.

## O que pode ser revisado

- **Minha análise:** seleção Diário/Semanal/Sprint, apresentação de totais, corte, diferença, tolerância indefinida, qualidade das fontes e evidências. Um exemplo diário fixo ilustra valores; os demais períodos mostram indisponibilidade. Nenhum cálculo de horas ou resolução de período oficial é executado no cliente.
- **Central de notificações:** exemplos não lidos/histórico, detalhe, análise original de aviso atrasado e leitura explícita, sem encerrar ocorrência.
- **Relatórios de erros:** filtros de pessoa/dia/tipo, exemplos de batida ímpar e cronômetro aberto no fechamento, evidências/revisão.
- **Enviar agora:** mensagem, destinatário individual/todos, período, revisão e confirmação exclusivamente visual. Alterações invalidam a revisão anterior.
- **Histórico de envios:** exemplo de sucesso parcial, distinção entre enfileirada/entregue/lida e repetição visual somente do destinatário com falha.
- **Agendamentos:** propostas 10h/11h50/17h, criação e edição em memória, horário/mensagem/finalidade, ativação ilustrativa e exclusão com confirmação.
- **Configurações globais:** tolerância sem default presumido, alcance global, fuso, revisão e conflito de edição preservando o rascunho.

Os seletores superiores permitem revisar Membro, Líder e Coordenador e estados de carregamento, vazio, falha de conexão, sessão expirada, acesso negado, fonte indisponível, falta de associação e conflito. A seleção de perfil é exclusivamente uma ferramenta de revisão, não um mecanismo de autorização. Os exemplos e rascunhos são descartados ao sair da tela, trocar de perfil, reiniciar o exemplo ou recarregar. Não usar textos ou valores fictícios como resultados de homologação.

## Dependências reais

No início desta etapa, o snapshot tinha 39 caminhos, sem essas operações, e a API local não respondeu. Durante a implementação, outro trabalho no mesmo checkout atualizou os snapshots e acrescentou rotas de análises, configurações, agendas, envio e caixa individual, além de código em `src/notifications` e no desktop. Esta prévia não altera esses contratos nem comprova a integração concorrente. Confira o snapshot atual e a validação do trabalho de integração antes de promover qualquer recurso.

Antes de integrar cada tela, validar a cobertura do contrato real para configurações globais/versionamento/permissão efetiva, agendas e exclusão, análise centralizada, prévia/envio idempotente e resultados por destinatário, relatórios de ocorrências/revisões, caixa individual paginada, confirmação de recebimento, leitura e histórico de envios. Sincronizar o snapshot e os tipos conforme AGENTS.md; não converter os modelos visuais deste módulo em DTOs supostos.

Na integração, substituir os cenários por estados reais (ProblemDetails/code/correlationId, carregamento, autorização e concorrência). O servidor deverá resolver escopo, períodos e corte único em São Paulo. Não derivar destinatários nem classificar diferenças em React/WPF.

**Desktop fora desta entrega:** início com Windows, bandeja, avisos nativos e recuperação paginada com registro durável e deduplicação são tratados pelo trabalho concorrente. A prévia apenas ilustra o aviso atrasado; não implementa recebimento ou confirmações. Esta etapa não altera tokens/DPAPI ou allowlist e não valida o novo código nativo.

## Verificação

`tests/browser/analysis-preview.spec.ts` verifica navegação, ausência de chamadas à API/storage, acessibilidade e largura em desktop/celular, edição/exclusão de agenda, conflito de configuração, invalidação de revisão de envio, leitura explícita e estados indisponíveis. O build deve ser inspecionado para confirmar que nenhum módulo ou fixture da prévia foi incluído.

Esta etapa não modifica o backend, não publica o frontend e não comprova entrega ou recebimento de notificações reais.
