# Histórico diário — contrato e apresentação

Revisado em 04/10/2026, Front `eb63dbd` e API `b36c6e1`. Histórico administrativo, próprio e de pessoa dos times compartilham `DailyHistory`, `useHistory` e `history-data.ts`. Ver [contexto](CONTEXTO-ATUAL.md) e [compatibilidade](compatibilidade-backend.md).

## Comportamento existente

- Cada data com registros aparece inicialmente fechada, com Monday, VR e diferença Monday − VR retornados pela API, sinal e descrição.
- Expandir mostra registros das fontes, atividades/durações/estados. No detalhe Monday, mostrar somente Início, Fim, origem Manual/Cronômetro e link HTTPS quando disponível; origem desconhecida permanece indisponível. `manual: true` informa lançamento manual; `manual: false` explícito ou `running: true` informa cronômetro. O detalhe VR mostra somente horários de início/fim quando fornecidos, batidas informadas na ordem recebida, link quando disponível e origem manual somente se explicitamente informada. Sem horários/batidas, informa indisponibilidade. Não mostra importação/referência externa nem infere pareamento ou cronômetro. Campo não fornecido permanece indisponível.
- Filtro de fonte restringe detalhes e dias encontrados; resumo do dia usa ambas as identidades para evitar diferença artificial pelo filtro.
- Alterar pessoa, período ou fonte invalida consulta/resultados/expansão anteriores. Resposta atrasada de um contexto anterior é descartada.
- Durações preservam segundos e podem ultrapassar 24h; não arredondar antes da comparação. Datas civis conservam o dia da API; instantes são apresentados em São Paulo.

## Contrato e significado dos números

`GET /api/v1/organization/time-control/history` aceita período inclusivo de até 90 dias, pessoa/fonte conforme contrato e autorização. Cada pessoa possui `records` e `days: TimeAnalysisDay[]`: dia, `mondaySeconds`, `vrSeconds`, `deltaSeconds`, `partial` e `issues`. O React agrupa/apresenta; o motor e os totais pertencem à API.

Os dados descrevem importações armazenadas; não certificam cobertura/completude/atualidade nem saldo trabalhista. A consulta não busca Monday/VR, não envia avisos e não prolonga timers até agora. Monday ausente/nulo/inválido/aberto não vira zero. VR ausente/inconsistente impede diferença; VR do dia corrente fica nulo, pois esse snapshot não permite extrapolar batidas. Dias futuros não recebem estimativas.

Análises/notificações usam seus próprios snapshots e cortes. Não substituir um aviso passado por registros atuais nem usar histórico importado para liberar energia; o fluxo normal usa análise ao vivo na API. Override administrativo ativo por PIN pode liberar temporariamente sem análise, e continua sujeito à revalidação nativa.

Quando uma API anterior não retorna `days`, a interface ainda permite agrupar/abrir registros e informa resumo indisponível. Não fabricar totais para esconder incompatibilidade. Mudança de contrato deve seguir [compatibilidade](compatibilidade-backend.md), implantando a API correspondente antes do front dependente.

## Acesso e validação

Autorização é da API e segue vínculos vigentes hoje, mesmo para datas antigas. Não atribuir horas a times históricos nem tratar ausência de pessoa no escopo como zero. Ao perder vínculo, seleções/resultados de outra pessoa não podem conceder acesso.

Nesta reescrita houve inspeção de código/contrato, sem testes autenticados ou fontes reais. Testes de fixtures existentes verificam agrupamento, imutabilidade, nulabilidade, contexto e apresentação. Homologação futura deve comprovar IDs/fontes, período de 90 versus 91 dias, datas São Paulo, sessão aberta/importação incompleta, fonte filtrada e tentativas fora do escopo. Swagger, PostgreSQL de teste e respostas simuladas não comprovam integração de produção.
