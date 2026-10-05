# Acompanhamento pessoal

**Minha jornada** consulta automaticamente `GET /api/v1/me/time-control/overview?period=daily` após login. Contrato e cálculo pertencem à [CEP API](https://github.com/luisotvbim-sudo/CEP-API), em `docs/personal-overview.md`; [demanda #17](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/17).

O resumo apresenta situação oficial, corte, até três métricas e dias de atenção. Detalhe diário e qualidade das fontes ficam em expansão acessível. Períodos/datas vêm da API; React não calcula tolerância/classificação. Desconhecido não é zero. Dia em andamento é parcial; diferenças pedem revisão na origem sem definir débito, produtividade ou irregularidade.

**Meu histórico** conserva registros importados e filtros. Notificações e análises persistidas mantêm seus fluxos/cortes. Conferir agora lê fontes; Atualização importa histórico; nenhuma atualiza avisos antigos por inferência. Ler aviso não resolve ocorrência.

`overview-api.ts` mantém somente requisições em voo por cliente, deduplica períodos iguais e serializa chamadas. `useOverview.ts` espera 250 ms ao trocar seleção, invalida respostas antigas e conserva resultado anterior somente após falha de repetição do mesmo período, com corte e aviso. Opções continuam selecionáveis durante leitura; seleções superadas na fila não iniciam consultas externas. Logout invalida respostas e remove dados da tela. Sem persistência de horas/tokens ou polling.

API antiga (404), resposta inválida, associação ausente/inativa, fonte parcial, 429 e falha após resultado válido têm recuperação explícita. `Retry-After` é propagado no navegador e bridge; sem header, a proteção de repetição espera 60 s. Timeout: 90 s no endpoint, 100 s no HTTP web/host e 110 s no bridge. Erro HTTP não abre contingência de energia.

Snapshots real/consumido e tipos gerados incluem o contrato definitivo. Allowlist nativa acrescenta somente GET pessoal. Sessão/DPAPI e poderes de energia continuam nos componentes responsáveis. API compatível precede consumidor. Main do Front e piloto MSI 0.4.10 são entregas separadas: este trabalho não integra automaticamente a tela ao piloto nem homologa instalação.

Fixtures sintéticas verificam estados, teclado/acessibilidade, um h1, corte anterior após falha, espera, troca rápida e 360 px. Capturas não demonstram fontes reais ou versão implantada.
