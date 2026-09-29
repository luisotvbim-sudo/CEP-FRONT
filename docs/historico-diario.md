# Histórico agrupado por dia

Implementação local de 29/09/2026, compartilhada por Histórico administrativo, Meu histórico e Histórico da pessoa nos times. Navegador e WebView usam o mesmo componente `DailyHistory`.

- Cada data com registros tem uma linha inicialmente fechada: duração Monday, jornada VR Mais e diferença Monday − VR, com sinal e descrição.
- Expandir mostra as duas fontes, suas atividades, durações, estados e os detalhes já disponíveis (horários, batidas, atualização e link de origem).
- O filtro de fonte restringe os registros detalhados e os dias encontrados. O resumo desses dias considera ambas as fontes, evitando diferenças artificiais causadas pelo filtro.
- Mudanças de período, pessoa ou fonte limpam os resultados e a expansão anterior.
- Durações permanecem em segundos, sem arredondamento da diferença; datas civis mantêm a data da API e horários usam São Paulo.

## Contrato e limite dos números

`GET /api/v1/organization/time-control/history` conserva os parâmetros e `records`; cada pessoa recebe também `days: TimeAnalysisDay[]` (`day`, `mondaySeconds`, `vrSeconds`, `deltaSeconds`, `partial`, `issues`). O backend reutiliza `TimeAnalysisEngine` com proteção específica para registros armazenados. O React não calcula totais.

Os números descrevem os registros importados, não certificam a cobertura/completude das fontes nem são saldo trabalhista oficial. Monday ausente, duração nula/inválida ou cronômetro aberto não viram zero. VR ausente/inconsistente impede diferença; a jornada VR do dia corrente fica indisponível porque o histórico armazenado não permite prolongar batidas até a hora da consulta. Dias futuros não recebem estimativas. A consulta não busca Monday/VR nem envia notificações.

Análises e notificações já apresentam uma linha por dia a partir do seu próprio resultado persistido. Elas mantêm o corte e os valores originais; não se substitui uma análise passada pelos registros atuais do histórico.

Implantar primeiro o backend atualizado. Com uma API anterior, o front agrupa e permite abrir os registros, mas informa que o resumo diário está indisponível, sem inventar totais. Não há mudança de autenticação, escopo, banco, migrations ou ponte desktop.

## Validação

Snapshots obtidos do Swagger da aplicação local compilada, sem conexão ao banco local. Testes de integração usam PostgreSQL isolado via Testcontainers e fontes de teste; testes de navegador usam respostas simuladas identificadas no código. Isso não equivale a homologação autenticada com os dados de produção.
