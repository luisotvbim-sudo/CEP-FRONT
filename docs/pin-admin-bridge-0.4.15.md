# Correção do retorno do PIN administrativo — MSI 0.4.15

Demanda: [CEP-ORQUESTRADOR #26](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/26).

Em 06/10/2026, o usuário relatou que **Energia do computador → PIN
administrativo → Liberar por 5 minutos** mostrou “O aplicativo retornou uma
resposta inválida” após a tentativa. O valor do PIN não foi colocado no código,
nos testes ou neste documento.

## Diagnóstico

`DesktopAuthClient` produz essa frase quando rejeita o envelope nativo, antes
de `PowerApi` analisar o resultado de liberação. `MainWindow.Bridge` serializa
falhas da API com campos opcionais nulos, especialmente `retryAfterSeconds` na
ausência de `Retry-After`; `code` também pode ser nulo. O validador do bridge
0.4.14 aceitava ausência desses campos, mas recusava o valor JSON `null`.
Assim um erro HTTP legítimo era mascarado como resposta inválida. A captura
não revela o status ou código real da API e não prova que o PIN foi aceito ou
recusado.

O 0.4.15 aceita `null` nos campos opcionais e converte atraso ausente para
`undefined` ao criar `AuthError`. O cliente continua rejeitando envelopes
malformados; respostas HTTP de erro não são convertidas em falha de transporte
nem autorizam contingência de energia. O contrato da API, a validação de
sucesso, o PIN e o serviço de energia não foram alterados.

## Validação e próxima observação

Os testes com PIN sintético verificam que respostas nativas 403, 429 e 503 com
campos nulos preservam status, código e mensagem apropriada. Outros testes
verificam liberação válida com prazo de cinco minutos, revalidação pelo host e
que o PIN não alcança serviço ou sessão persistida. Build, inspeção MSI,
CI e piloto real devem ser registrados separadamente.

Após instalar 0.4.15 em estação piloto, fazer no máximo uma nova tentativa
autorizada e registrar apenas versão instalada, status/código da falha ou
resultado de sucesso, sem o valor do PIN. Se houver 403, verificar a credencial
dedicada configurada na API (distinta da senha diária da bandeja); se houver
429, aguardar o limite; se houver 503, revisar o provisionamento na API.
Publicação no canal `releases/latest` continua separada do piloto.
