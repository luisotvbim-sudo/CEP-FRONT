# Revisão para publicação web — 06/10/2026

Autorização humana: revisar, testar e publicar Front web e API em produção, com API compatível primeiro. [PR #18](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/18) agrega as mudanças pessoais e a [refatoração estrutural](refatoracao-front.md). Main conferida `8f0c44a6825f8af74ebe63ea75cac08e7ed83a5d`, ancestral da entrega. Commits por tema continuam disponíveis no histórico.

## Revisão da integração

- Nenhuma diferença em `HttpAuthClient`, `DesktopAuthClient`, transporte bridge, tipos gerados, snapshots OpenAPI, C#/XAML/WiX, Dockerfile, Compose de produção ou scripts de deploy. PR #16 de energia/MSI não está nesta integração. Configuração mock/TESTE, perfis nativos e arquivos privados não estão no diff.
- API precisa entregar senha mínima 6 e atualização normal de 17 dias antes da troca do Front. A mudança de rótulo não altera período oficial de análise ou a carga administrativa de até 90 dias.
- Clientes continuam com access token em memória e refresh protegido de mesma origem; não há acesso direto a Monday/VR nem persistência de horas/tokens no navegador. Allowlist nativa permanece fechada.
- Administração conserva navegação e operações. Rotas organizacionais continuam recebendo a organização selecionada; configuração global e caixa pessoal não herdam esse parâmetro. Escopo continua imposto pela API.
- Queries conservam invalidação por chave, descarte de respostas atrasadas e paginação. Histórico conserva `null`, resumo do servidor e cortes distintos de jornada/análise. A sincronização conserva submissão única e consulta de andamento sem repetição automática de gravação.
- Sino abre a caixa paginada sem leitura/recebimento automático. Foco, Escape, clique fora, filtro e leitura explícita possuem cobertura de navegador e acessibilidade. Conta/logout conserva tratamento de falhas.
- Download mantém o asset existente `CEP-Horas-Windows.zip` da prerelease `desktop-v0.2.0.1-test`, conferido via GitHub; nenhum link de MSI draft foi promovido. Prévia e fixtures permanecem fora do bundle de produção.

## Evidência disponível e aceite operacional pendente

Código da refatoração aprovado localmente: lint, 100 unitários, build e 220 Playwright desktop/mobile; imagem aplicada e conferida nos dois Docker de teste. PR #18 executa a CI do HEAD completo, com jobs web e desktop. Compose de produção foi validado e os quatro scripts Bash passaram em `bash -n` na revisão final. Dois resíduos de linhas vazias no fim de arquivos foram corrigidos após conferir o diff completo contra main.

Antes de qualquer publicação, a leitura pública com TLS normal retornou 200 em `/`, `/download` e `/healthz`, CSP de mesma origem na página e 401 em `/api/v1/me`. Assets observados: `/assets/index-BMb3qi70.js` e `/assets/index-D4bcLbyK.css`. Isso é uma referência anterior à troca; não identifica SHA implantado nem comprova fluxo autenticado.

O único mecanismo de implantação encontrado neste repositório é o script/systemd versionado em `deploy/nightly`, que exige CI de push do SHA exato, build antes da troca e retorno à tag anterior se a verificação falhar. O workflow GitHub existente valida o código; não publica sozinho na VM. A existência dos arquivos não comprova timers ativos. Acesso SSH, checkout/imagem efetivos, marcador de implantação, imagem anterior disponível, rede/proxy e estado dos timers precisam ser conferidos no host antes de aplicar. Não alterar fontes, segredos, banco ou serviço API pela frente web.

Preparação não equivale a publicação. O Front aguarda confirmação da API compatível efetivamente implantada e acesso operacional à VM; merge e troca do contêiner não foram executados nesta revisão. A publicação deve manter contêiner sem porta publicada, usuário sem privilégios, filesystem read-only, volumes independentes e proxy `/api/` direto à API. Depois, conferir SHA/imagem e assets servidos, TLS, CSP, `/healthz`, recusa anônima e fluxos autenticados seguros que estiverem disponíveis, sem envio/leitura de avisos ou outras gravações reais.
