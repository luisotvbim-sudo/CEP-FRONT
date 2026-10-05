# Orientações para agentes do CEP-FRONT

CEP-FRONT é responsável por web, aplicativo Windows, serviço e instalador do CEP Horas. O protótipo separado 01-CEP-INSTALADOR não é o instalador deste produto.

## Leitura e evidência

1. Leia `README.md`, `docs/CONTEXTO-ATUAL.md`, `docs/produto/especificacao-funcional.md` e `docs/compatibilidade-backend.md` antes de alterar produto ou integração. `docs/README.md` aponta os contratos específicos.
2. Confira checkout, branch, SHA, alterações locais e o AGENTS da frente correspondente. Diferentes chats podem compartilhar a pasta; coordenar edições sem presumir um checkout por conversa.
3. O código da base escolhida é a melhor referência de funcionamento implementado. A especificação/aditivos registram intenção funcional; requisitos planejados não são funcionalidades existentes nem autorização para ampliá-las.
4. Separe implementação, GitHub, CI, release e implantação. Não transformar teste histórico/mocks, Swagger ou health check em homologação atual. Registrar lacunas em vez de inventar decisões antigas.
5. A fila transversal e o contexto de coordenação ficam no [CEP-ORQUESTRADOR](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR). Conservar objetivo, decisão, base e aceite no GitHub; nenhum contexto necessário deve existir somente no chat.

## Contratos e segurança

- Leia `docs/openapi-backend-current.json`, `docs/openapi.json` e os contratos do recurso. Não invente rotas, campos, enums ou permissões. Cálculo de horas, períodos oficiais, tolerância, destinatários e autorização pertencem à API.
- Quando a API mudar, confirme o commit executado e atualize primeiro o snapshot real. Substitua o contrato consumido, regenere `src/auth/api-schema.d.ts` e adapte cliente/allowlist/testes quando o front puder consumir o contrato completo. Uma API local antiga não deve regredir os snapshots.
- API local de desenvolvimento: `http://127.0.0.1:8080`, Swagger `/swagger`. Sem PostgreSQL/fontes/conta de homologação, registre validação por contrato/fixtures, sem afirmar fluxo real validado.
- Monday e VR Mais passam exclusivamente pelo backend. Não copiar tokens externos, credenciais, PINs, códigos de convite, chaves, dados pessoais ou inventário privado para Git/documentação/logs.
- Web mantém refresh em cookie protegido de mesma origem e access token em memória. Desktop guarda tokens no host com DPAPI; React recebe somente resultados/metadados. Não persistir tokens/dados de horas no navegador. Não repetir automaticamente gravações nem refresh com resposta incerta.
- API impõe isolamento organizacional; filtros no React não substituem autorização. Configurações globais não tornam relatórios/pessoas/destinatários globais. `SystemAdmin` informa organização explicitamente nas rotas organizacionais.
- `null` não vira zero. GET de análises lê snapshots persistidos; histórico importado, análise persistida e decisão de energia ao vivo têm cortes e limites diferentes.

## Windows, instalador e deploy

Leia `docs/aplicativo-windows.md`, `docs/instalador-corporativo.md` e `docs/menu-energia.md` ao alterar o host/serviço/pacote. Revalidar no WPF a decisão de energia da API; qualquer resposta HTTP impede tratar a API como offline. O serviço aceita ações fixas, atraso/cancelamento e IPC restrito; não abrir comandos/caminhos/URLs arbitrários.

As bases MSI divergem: `main` auditada tem 0.4.3; `codex/installer-integrado` tem 0.4.6; PR #9 contém atualizador e 0.4.7–0.4.9 fora da `main`. Conferir a branch antes de descrever recuperação, saída protegida ou atualização. CI/inspeção estrutural não substituem homologação elevada Windows ou upgrade real. Web e MSI possuem ciclos de publicação distintos.

Para produção web, preservar `deploy/README.md`: imagem sem privilégios/read-only e contêiner sem porta publicada; Nginx de borda encaminha site e `/api/` aos serviços independentes. Não habilitar CORS nem persistir tokens no renderer. Mudanças de deploy exigem checks de Compose, Docker, Bash, proxy e `/healthz`, sem pressupor SHA implantado.

## Manutenção documental

Atualize contexto e contrato do recurso no mesmo trabalho. Preserve IDs RF/RN/CA/D, requisitos úteis ainda planejados e a evidência que fecha uma decisão. Não acrescentar blocos de prompts, relatos de uma tarefa antiga ou contagens de testes como estado corrente. Histórico removido da árvore continua no Git; registrar sucessor no índice em vez de manter dois contextos contraditórios. Registre as verificações efetivamente realizadas na entrega.
