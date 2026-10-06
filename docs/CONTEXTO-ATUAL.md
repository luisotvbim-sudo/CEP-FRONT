# Contexto atual do CEP-FRONT

Preparação beta 0.4.13 em 06/10/2026: [pacote e distribuição](beta-msi-0.4.13.md)
consolidam interface main `18aa262` e auditoria Windows `32983a5`. Esta branch
mantém senha 6–200 e a UI atual; `/download` aponta ao MSI beta 0.4.13 no GitHub.
Publicar o draft deve preceder a implantação desse link. Piloto Windows e
distribuição a 40 usuários são etapas distintas da geração do pacote.

Mapa de manutenção e auditoria da base de testes: [limpeza do Front](mapa-front-limpeza.md). A fixture de acompanhamento pessoal fica em `tests/fixtures/overview.ts`; não é um módulo de execução do produto. Matrizes datadas abaixo são evidências históricas, e a auditoria identifica separadamente main, web de teste e desktop mock.

Na branch de refatoração web, `AccountControls` apresenta a conta e `useLogout` controla a saída; `TeamHistory` mantém o histórico selecionado dentro da navegação de membro/líder. `HistoryFields` compartilha os campos de período/fonte; `useSynchronization` controla submissão e acompanhamento, enquanto `SyncPage` apresenta os modos pessoal/administrativo. `AdminApi` e `NotificationApi` dependem somente de `request`. Comportamento, contratos e estado de aplicação nos testes estão na [entrega da refatoração](refatoracao-front.md); essa estrutura não comprova integração à main ou ao desktop.

Membro/Líder acessam avisos pessoais pelo sino no cabeçalho, com contagem de não lidas e dropdown paginado. “Ver meus avisos” abre o dropdown; a central completa e o destino nativo continuam disponíveis. Abrir/expandir não marca leitura nem recebimento. Administração conserva sua navegação atual. Ver [notificações](notificacoes-implementacao.md).

Membro/Líder usam o botão “Reprocessar dados do Monday” em Meu histórico, com a orientação “Use este botão sempre que editar registros no Monday para atualizar os dados no CEP.” O bloco pessoal mostra somente o botão, a orientação e feedback acessível de andamento, conclusão/resultado parcial ou erro, sem painéis técnicos por fonte. A operação normal continua consultando Monday e VR Mais por 17 dias; o rótulo não restringe a API ao Monday. Sucesso total ou parcial recarrega o histórico com os filtros atuais, sem repetir a submissão. Coordenador conserva a tela administrativa e opção de até 90 dias.

Sincronização normal: botão administrativo “Atualizar sprint” e botão pessoal “Reprocessar dados do Monday”, janela móvel de 17 dias incluindo hoje, dependente da API com essa política. O nome do botão não muda os períodos oficiais de análise da sprint (1–14/15–fim do mês); reprocessamento administrativo permanece até 90 dias.

Detalhe de registro Monday: somente Início/Fim, origem informada Manual/Cronômetro e link da atividade quando disponível. Título, duração e estado continuam fora do detalhe; VR mostra apenas horários conhecidos/batidas informadas, link e origem explícita, sem metadados complementares nem pareamento inferido. Ausência de flags de origem não permite inferir cronômetro. Ver [histórico diário](historico-diario.md).

Política de senha em 05/10/2026: formulários de ativação e recuperação e mensagens permitem mínimo de 6 e máximo de 200 caracteres. Requer API com a regra atualizada antes da publicação do cliente; sem mudanças nas rotas/allowlist. Código e builds não comprovam publicação web ou versão Windows instalada.
Referência Windows conferida em 06/10/2026: [contexto do instalador](CONTEXTO-INSTALADOR.md) e [auditoria 0.4.12](AUDITORIA-INSTALADOR-2026-10-06.md). As matrizes datadas de 04/10 abaixo são históricas; a auditoria separa código, draft, checks e homologação pendente.


Correção em 05/10/2026 na branch `codex/liberacao-energia-ao-fechar`, base main `72941ad`: [0.4.12](liberacao-energia-0.4.12.md) preserva direitos de logon para restaurar controles ao fechar com senha diária, por escolha explícita do usuário. Não substitui a evidência do pacote 0.4.11 já instalado; consultar resultado de build/instalação no registro central da Issue #19.

Continuidade em 05/10/2026: acompanhamento pessoal integrado à main `53d8e5be438e18b2c67e7bcff82f8806330ada8e`, API/main `ba07f772f3ed9914a80ef9dfa4543385a742ecea`. A branch `codex/instalador-pronto` integra essas mudanças ao serviço/atualizador e ao [pacote 0.4.11](instalador-0.4.11.md), com recuperação durável de energia. Matrizes antigas abaixo conservam a auditoria datada; conferir o registro desta entrega antes de assumir versão publicada ou instalada.

Reescrito em 04/10/2026 a partir do código e dos contratos versionados. Entrada para continuar em qualquer computador: [README](../README.md), [índice](README.md), [especificação](produto/especificacao-funcional.md) e [compatibilidade](compatibilidade-backend.md). Base analisada: Front `eb63dbdc7f7bf83d0a4b51ee5567ed5aa80c138c`; API `b36c6e149b42253b44860d98c6ffe44f98c53dd6`.

## Responsabilidade e limites

Este repositório entrega apresentação web/desktop e integração nativa Windows. A API autentica e autoriza cada operação, associa identidades, consulta as fontes e fornece resultados oficiais do produto. Não há consulta anônima de horas, funcionário fixo no renderer nem cache offline de análises. `/api/v1/time-logs` não faz parte do contrato.

O instalador CEP Horas está neste repositório. O projeto separado CEP Hub/01-CEP-INSTALADOR é protótipo distinto. Versão web, API, MSI e versão instalada devem ser registradas separadamente; documentação de uma branch não comprova integração ou publicação.

## Navegação e escopos implementados

`src/App.tsx` seleciona `SystemAdminShell`, `AdminShell` ou `UserShell` pelo usuário autenticado. A API define o alcance; mudar tela/filtro não concede acesso.

| Área | Comportamento atual |
|---|---|
| Pública | Login, recuperação/redefinição, ativação de convite; `/download` apresenta o MSI beta 0.4.13 sem autenticar/consultar a API |
| Coordenador (`organizationAdmin`) | Pessoas, associação/convite, sincronização, times/vínculos, histórico, usuários, auditoria, central própria, análises/erros, envio e configurações globais |
| Membro (`user`) | Minha jornada, Meu histórico com botão de reprocessamento, sino/central pessoal e análises próprias |
| Líder (`user` com vínculo `manager`) | Visão pessoal mais times geridos, histórico das pessoas visíveis e análises dos times |
| Administrador técnico (`systemAdmin`) | Organizações, configurações globais e central própria; seleciona organização para operações de pessoas/envio/histórico/administração |

Vínculos considerados pela autorização são os vigentes hoje em times ativos, inclusive ao consultar registros antigos. Usuário sem vínculo ativo pode não receber pessoa/histórico mesmo tendo associação. Não interpretar esse vazio como zero horas ou inventar atribuição histórica dos registros ao time. A política pós-transferência continua parcialmente pendente na especificação.

## Sessão e transporte

`AuthClient` é a fronteira da interface. `HttpAuthClient` usa `/api/v1` de mesma origem; `DesktopAuthClient` usa mensagens tipadas no WebView2. Erros `ProblemDetails` são traduzidos por `code`, conservando `correlationId` sem exibir detalhes internos.

- **Web:** access token somente em memória; refresh rotativo em cookie protegido `HttpOnly`/`SameSite=Strict`/`Secure`, prefixo `__Host-` em HTTPS e expiração absoluta de até sete dias. Login/refresh/logout usam `/auth/web/...`. Web Locks serializa rotação entre abas e BroadcastChannel propaga alterações de sessão. Marcadores não secretos de interrupção não são tokens/cache de dados.
- **Windows:** `ApiSession` faz as chamadas e guarda refresh com `ProtectedJsonFile`/DPAPI `CurrentUser`, separado pela origem da API. Access token permanece no host. `ApiRoutePolicy` permite métodos/rotas explícitos. O bridge devolve metadados e resultados permitidos, nunca tokens.
- **Renovação:** um refresh em curso é compartilhado; resposta perdida/incerta exige novo login sem reapresentar o token anterior. Gravação não é repetida silenciosamente por falha de rede. Servidor revalida conta, organização, sessão e permissões.

Ativar convite retorna 204 sem sessão/token/cookie; depois o usuário faz login do seu canal. O endpoint legado de aceite que emite tokens não é usado pelo formulário web. Ver [ativação](contrato-ativacao-convite.md) e [reenvio](contrato-reenvio-convite.md).

## Pessoas, sincronização e histórico

Desde a entrega em branch de 05/10/2026, Minha jornada usa [acompanhamento pessoal](acompanhamento-pessoal.md), com consulta automática ao endpoint aditivo da API, situação/corte e detalhe progressivo. Meu histórico mantém a leitura importada em página própria. A nova interface depende da API compatível; sua presença nesta branch não comprova publicação web ou integração no piloto MSI.

Diretórios Monday/VR são paginados no backend; a interface escolhe IDs internos ativos e ainda não associados. Correspondência por e-mail exato/único é sugestão, exige confirmação humana. Nomes iguais não criam associação automática. Associar/convidar enfileira e-mail, sem provar entrega.

Atualização normal reavalia hoje e os 16 dias anteriores; reprocessamento completo/carga inicial administrativa cobre até 90 dias. Não é delta puro por cursor. Fontes apresentam tentativa, resultado, contagens/cobertura e falhas independentes; última tentativa não significa último sucesso. Membro/Líder não recebem a opção de reprocessamento administrativo, e sua última tentativa é a que solicitaram.

`GET /organization/time-control/history` aceita até 90 dias inclusivos e retorna registros mais resumos diários da API. `DailyHistory`/`history-data.ts` agrupam/apresentam, sem calcular totais. Filtro de fonte restringe detalhes/dias encontrados; resumo de cada dia usa ambas as identidades. Datas civis preservam o dia da API; instantes usam São Paulo e durações mantêm segundos/sinal, inclusive acima de 24h.

Histórico é importado: não consulta fontes agora, não prolonga timer aberto e não calcula VR corrente por extrapolação. Ausente/inválido permanece nulo. Uma análise persistida conserva o corte/valores originais; não é substituída pelo histórico atual. Ver [histórico diário](historico-diario.md).

## Análises e notificações

`src/notifications/` consome configurações globais, agendas, prévia/envio, central, histórico de envios e relatórios persistidos. Aditivo funcional: [contrato atual](contrato-analises-notificacoes.md); integração: [notificações](notificacoes-implementacao.md).

- Diferença = Monday − VR, tolerância inicial simétrica de 30 minutos, comparação em segundos; limite exato permitido. Divergência absoluta soma magnitudes diárias. O cliente não classifica horas nem escolhe destinatários oficiais.
- API resolve dia São Paulo, semana segunda-feira e sprint 1–14/15–fim do mês, com corte único da execução. Total agregado fica nulo se seus dias não tiverem os valores necessários; não fabricar subtotal/taxa de cobertura.
- Configurações/agendas são globais, com versão para concorrência. Pessoas, relatórios e envios continuam no escopo organizacional. Automação nasce desativada; estado ativo na implantação requer confirmação.
- Prévia confirma quantidade/período; corte final é o do processamento. Alterar conteúdo invalida confirmação. Uma resposta incerta conserva `requestId`; mesma chave/conteúdo identifica o mesmo envio. Enfileirado, processado, recebido e lido não são equivalentes.
- GET de análises lê snapshots emitidos pelo processamento/envios; “Atualizar consulta” não importa nem reanalisa as fontes. Ausência de relatório não significa horas corretas.
- Windows recupera todos os avisos pendentes de todas as páginas, grava IDs com DPAPI antes de confirmar recebimento e resume o lote em popup. Intervalo mínimo entre resumos: cinco minutos. Recebimento não marca leitura nem mantém cópia offline de mensagens/análises.

O worker da API recupera slots do mesmo dia; não recompõe execuções de dias anteriores que nunca foram geradas. Isso é diferente de o Windows recuperar mensagens já existentes enquanto esteve desligado. Feriados/escalas/jornadas previstas e workflow de justificativas não estão implementados.

## Estrutura para manutenção

| Responsabilidade | Código |
|---|---|
| Consultas/ações e descarte de respostas antigas | `src/hooks/async.ts` |
| Query, organização e paginação em lotes limitados | `src/api/query.ts` |
| Sessão/transporte e erros | `src/auth/` |
| Administração e histórico | `src/admin/`, `src/user/` |
| Configurações, envio, central, análise e detalhes | `src/notifications/` |
| Formulários públicos e modais | `src/components/` |
| Sessão/allowlist/persistência nativa | `desktop/CepHoras.Desktop/ApiSession.cs`, `ApiRoutePolicy.cs`, `ProtectedJsonFile.cs` |
| Recebimento/popup | `desktop/CepHoras.Desktop/NotificationDelivery.cs`, `MainWindow.xaml.cs` |
| Energia/serviço/pacote | `src/power/`, `desktop/CepHoras.Control/`, `scripts/build-corporate-msi.ps1` |

Consultas descartam respostas invalidadas; ações bloqueiam submissão simultânea. Diretório com página que falhou não é apresentado como lista completa. Histórico agrupa por mapas e só monta detalhes expandidos. Preserve esses comportamentos ao refatorar; redução de varreduras não é benchmark de produção.

`src/preview/` é revisão visual DEV com dados identificados, sem chamadas à API/storage/envios; não é demonstração dentro do fluxo autenticado. Fixtures de browser/nativo são descartáveis e não comprovam cobertura real.

## Bases Windows e próximos trabalhos

`main` `eb63dbd` contém MSI 0.4.3, instância por sessão e recuperação que reinicia host/WebView2 com backup de perfil. `codex/installer-integrado` `dc58bde` evolui até 0.4.6. PR #9, base `95fbf5c`, inclui atualizador MSI e 0.4.7–0.4.9, saída protegida e recuperação ampliada; permanece fora da `main` auditada. Não atribuir ao MSI da main recursos da branch.

O canal MSIX preservado no código da main é distinto do atualizador MSI em revisão. Prerelease ZIP não ativa nenhum desses canais. Guia de host: [aplicativo Windows](aplicativo-windows.md); decisões/políticas: [menu de energia](menu-energia.md), [contexto do instalador](CONTEXTO-INSTALADOR.md), [instalador](instalador-corporativo.md) e [atualizador MSI](atualizador-msi.md). A presença dos guias descreve a base correspondente, sem promover código da branch à main.

Pendências de produto conservadas em RN/RF/CA/D: calendário e exceções, sobreposição de sessões diferentes, política histórica de time, workflow/justificativas, exportação, retenção avançada e desempenho. Pendências operacionais: versões reais na VM, fontes/SMTP, homologação autenticada por perfil, Windows suportado, políticas/recuperação e upgrade MSI real. Registrar escopo/dono/aceite na [fila central](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues) antes de implementar.

## O que foi validado nesta reescrita

Inspeção de código/contratos e consistência documental. Nenhum build, instalação, envio de e-mail/aviso, operação autenticada de produção ou ação de energia foi executado por esta limpeza. CI e testes históricos devem ser consultados no commit correspondente, sem reapresentá-los como resultados atuais.

/download mantém somente título e card de download, sem seções de passos/FAQ. O card identifica MSI beta 0.4.13 e Windows 11 x64 Pro/Enterprise/Education 24H2+. Alterar o destino na branch não publica o MSI nem ativa canal do atualizador.
