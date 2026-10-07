# Acompanhamento pessoal

**Minha jornada** consulta automaticamente `GET /api/v1/me/time-control/overview?period=daily` após login. Contrato e cálculo pertencem à [CEP API](https://github.com/luisotvbim-sudo/CEP-API), em `docs/personal-overview.md`; [demanda #17](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/17).

O resumo apresenta situação oficial, corte e até três métricas. A página não mostra a lista de dias de atenção, a expansão de qualidade das fontes, atalhos e nota final; o histórico importado do período aparece abaixo dos cartões. Períodos/datas vêm da API; React não calcula tolerância/classificação. Desconhecido não é zero. Dia em andamento é parcial; diferenças não definem débito, produtividade ou irregularidade.

O terceiro cartão usa o VR Mais como referência de apresentação para o `deltaSeconds` (Monday − VR) que a API já calculou: positivo é **Sobrando no Monday**, negativo é **Faltando no Monday**, zero é **Sem diferença** e nulo é **Diferença indisponível**. A duração do cartão é absoluta; o sentido fica no rótulo. Isso não muda o cálculo nem transforma o ponto em conclusão trabalhista oficial.

**Meu histórico** conserva registros importados e filtros. Notificações e análises persistidas mantêm seus fluxos/cortes. Conferir agora lê fontes; Atualização importa histórico; nenhuma atualiza avisos antigos por inferência. Ler aviso não resolve ocorrência.

Em **Minha jornada**, a seleção de período oficial também consulta o histórico importado da própria pessoa com as datas `from`/`to` devolvidas no item correspondente de `periods`. O bloco usa `GET /api/v1/organization/time-control/history` com `workforcePersonId` da associação autenticada e reutiliza `DailyHistory` e `RecordDetails` de Meu histórico, com ambas as fontes. A consulta é independente da leitura ao vivo: mostra o horário em que o histórico foi gerado, distingue ausência de registros de zero horas e oferece nova tentativa sem ocultar o resumo quando o histórico falha. Troca de período ou sessão descarta o resultado anterior. O contrato OpenAPI não muda; o acesso próprio sem time vigente depende da API #27.

`overview-api.ts` mantém somente requisições em voo por cliente, deduplica períodos iguais e serializa chamadas. `useOverview.ts` espera 250 ms ao trocar seleção, invalida respostas antigas e conserva resultado anterior somente após falha de repetição do mesmo período, com corte e aviso. Opções continuam selecionáveis durante leitura; seleções superadas na fila não iniciam consultas externas. Logout invalida respostas e remove dados da tela. Sem persistência de horas/tokens ou polling.

API antiga (404), resposta inválida, associação ausente/inativa, fonte parcial, 429 e falha após resultado válido têm recuperação explícita. `Retry-After` é propagado no navegador e bridge; sem header, a proteção de repetição espera 60 s. Timeout: 90 s no endpoint, 100 s no HTTP web/host e 110 s no bridge. Erro HTTP não abre contingência de energia.

Snapshots real/consumido e tipos gerados incluem o contrato definitivo. Allowlist nativa acrescenta somente GET pessoal. Sessão/DPAPI e poderes de energia continuam nos componentes responsáveis. API compatível precede consumidor. Main do Front e piloto MSI 0.4.10 são entregas separadas: este trabalho não integra automaticamente a tela ao piloto nem homologa instalação.

Fixtures sintéticas verificam estados, teclado/acessibilidade, um h1, corte anterior após falha, espera, troca rápida e 360 px. Capturas não demonstram fontes reais ou versão implantada.
