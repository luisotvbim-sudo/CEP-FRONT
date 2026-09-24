# Handoff — aplicativo Windows, notificações e atualizações

Atualizado em 24/09/2026. Este documento registra as tratativas e o estado verificável para continuar o trabalho em outro computador. Ele não declara como prontas as capacidades planejadas.

## Onde continuar

- Repositório: `luisotvbim-sudo/CEP-FRONT`.
- Branch de trabalho: [`codex/desktop-local-installer`](https://github.com/luisotvbim-sudo/CEP-FRONT/tree/codex/desktop-local-installer), iniciada no commit `79cbcc3`.
- A `main` não recebeu o instalador de teste. A VM do front acompanha a `main` diariamente às 02:15, conforme [`deploy/README.md`](../deploy/README.md). A branch isolada não deve ser confundida com publicação na VM.
- O aplicativo Windows é instalado no PC de cada usuário. A VM hospeda a API e, separadamente, o front web; ela não executa o aplicativo WPF.

Em outro PC, buscar a branch no GitHub, instalar Node.js/pnpm, .NET SDK 10 e Microsoft Edge WebView2 Runtime, e seguir o [`README.md`](../README.md). O ZIP de teste em `.local/package/` e a instalação em `%LOCALAPPDATA%` **não são versionados**; precisam ser recriados nesse computador. A pasta inteira publicada, incluindo `wwwroot`, é necessária.

```powershell
git clone https://github.com/luisotvbim-sudo/CEP-FRONT.git
cd CEP-FRONT
git switch --track origin/codex/desktop-local-installer
pnpm install --frozen-lockfile
pnpm build
dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained false -o .local/package/CEP-Horas-win-x64
```

`./scripts/install-desktop.ps1` instala no perfil do Windows atual; execute-o apenas quando quiser instalar nesse PC. Uma instalação existente não é substituída.

## O que existe e foi testado

- A interface React é compartilhada entre navegador e Windows WPF/WebView2; o host Release usa `https://api.cep.lat` por padrão. A sessão desktop guarda o refresh token com DPAPI no perfil Windows, fora da pasta do programa.
- `scripts/install-desktop.ps1` instala o pacote Release por usuário em `%LOCALAPPDATA%/Programs/Conceito/CEP Horas`, confere hashes SHA-256 dos arquivos e cria atalho no menu Iniciar. Também aceita um bundle extraído com `install.ps1` e subpasta `app/`. O script não substitui uma instalação ou atalho existente; não é instalador assinado, desinstalador nem atualizador.
- Em 24/09/2026, passaram `pnpm build`, `pnpm lint`, 18 testes unitários, `dotnet publish` Release framework-dependent e a verificação dos arquivos instalados. O executável instalado abriu em WebView2; após login real de Coordenador, Pessoas, Times e Usuários carregaram. Não foram gravadas credenciais no repositório.
- O teste autenticado acima cobre apenas Coordenador. Membro e Líder ainda precisam de homologação com contas próprias, sem alterar seus escopos no cliente.
- Este pacote exige .NET Desktop Runtime 10 e WebView2 Runtime no PC. Publicação autossuficiente (`--self-contained true`) não foi validada neste ambiente por indisponibilidade de acesso ao NuGet durante o teste.

## Requisitos acordados para a próxima etapa

- O aplicativo deverá iniciar com o Windows, permanecer disponível em bandeja e exibir notificações nativas no PC do destinatário. Isso **ainda não foi implementado**.
- O backend deve determinar quem recebe avisos por diferença entre Monday e VR Mais acima da tolerância aprovada. O programa de um usuário não deve calcular destinatários nem distribuir mensagens para os demais.
- O Coordenador deverá poder enviar avisos gerais ou direcionados; Membro e Líder devem receber somente o que lhes é autorizado. A central web e o aplicativo Windows devem refletir os mesmos dados e permissões do backend.
- Horários automáticos devem ser configuráveis e persistidos por organização. O exemplo inicial é 11:50 em `America/Sao_Paulo`, mas a definição de período, tolerância, conteúdo e destinatários precisa ser fechada antes de ativar envios.
- A ideia de consultar horas ao desligar o computador foi descartada. Não implementar bloqueio de desligamento.

Esses requisitos complementam a [especificação funcional](produto/especificacao-funcional.md), que ainda classifica notificações como planejadas. Não apresentar alertas automáticos como já entregues.

## Dependências do backend

A [PR #11 do CEP-API](https://github.com/luisotvbim-sudo/CEP-API/pull/11), branch `codex/notification-schedules`, estava **aberta e não mesclada** em 24/09/2026. Ela propõe `GET`/`POST /api/v1/organization/time-control/notification-schedules` e `PATCH /api/v1/organization/time-control/notification-schedules/{scheduleId}`, com horários por organização, padrão 11:50, ativação/desativação, auditoria e execução idempotente. A própria PR mantém o disparo desligado: cálculo Monday × VR Mais, tolerância, período e seleção de destinatários estão pendentes.

O [`openapi-backend-current.json`](openapi-backend-current.json) deste repositório ainda **não contém** essas rotas. Não criar cliente com endpoints supostos. Quando a API de referência disponibilizar o novo contrato, seguir [`AGENTS.md`](../AGENTS.md): sincronizar primeiro o snapshot real; atualizar `docs/openapi.json`, gerar `src/auth/api-schema.d.ts` e adaptar o cliente somente quando o contrato completo puder ser consumido. Além dos horários, o front ainda depende de contrato autenticado para listar/ler notificações do próprio usuário e para o envio autorizado pelo Coordenador. Os nomes e schemas dessas operações não estão definidos aqui.

## Atualização do aplicativo Windows

O instalador atual é manual e deliberadamente recusa sobrescrever arquivos. **Não existe atualização automática.** O mecanismo de produção ainda depende da escolha do canal de distribuição:

1. Se os PCs forem gerenciados por TI/Intune, avaliar distribuição e atualização centralizadas por esse canal.
2. Para instalação individual por link, avaliar MSIX assinado com arquivo `.appinstaller` publicado em HTTPS. O Windows oferece verificação de atualização ao iniciar e em segundo plano; assinatura e confiança do certificado são pré-requisitos. Referências: [atualização pelo App Installer](https://learn.microsoft.com/en-us/windows/msix/app-installer/auto-update-and-repair--overview) e [assinatura de MSIX](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide).

Isto é uma **proposta, não uma decisão ou implementação**. Antes de adotá-la, definir quem gerencia os PCs, política de assinatura, endereço de distribuição, versionamento, migração da instalação de teste, tratamento de app aberto, teste de atualização/recuperação e preservação da sessão DPAPI. Atualizações do desktop são independentes das publicações web/API na VM.

## Próximos passos seguros

1. Confirmar com o responsável se os PCs usam Intune/gestão corporativa ou instalação individual.
2. Concluir e publicar o contrato de notificações no backend, com seleção de destinatários feita no servidor; só depois sincronizar o OpenAPI e integrar a interface.
3. Implementar e testar bandeja, inicialização no Windows, recepção autorizada e aviso nativo, inclusive reconexão e notificações não lidas após ficar offline. A interface web deve consumir a mesma fonte de dados autorizada.
4. Escolher e implementar o canal de atualização assinado; validar em um segundo PC antes de distribuir à equipe.
5. Homologar Membro, Líder e Coordenador com contas de teste. Manter esta branch fora da `main` até haver decisão explícita de publicação, pois a VM monitora a `main`.
