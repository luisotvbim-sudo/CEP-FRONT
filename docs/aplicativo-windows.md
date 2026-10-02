# Aplicativo Windows — WebView2 e popup nativo

Implementação iniciada em 29/09/2026 e integrada ao instalador corporativo em 30/09/2026, na branch `codex/installer-integrado`. Reúne interface, sessão, notificações, controle de energia e instalação por máquina.

## Comportamento

- As telas de login, administração, análises e central pessoal continuam em React, dentro do WebView2. O host WPF cuida da sessão protegida, bandeja, popup e atualização do programa.
- Fechar a janela mantém o processo na bandeja. No MSI corporativo, o serviço relança o processo quando ele é finalizado sem autorização. **Sair da conta**, na interface, revoga a sessão.
- O menu da bandeja oferece **Abrir CEP Horas**, **Minhas notificações**, **Testar notificação** e **Fechar CEP Horas**. O fechamento abre uma janela de senha e aceita somente a data local em `ddMMyy` seguida de `#pec`; a validação é offline, preserva zeros iniciais e nunca registra a senha. Desde o MSI 0.4.5, depois da confirmação o serviço restaura a política original e suspende o relançamento daquela sessão. Abertura manual, logoff ou reinício do serviço reaplicam as restrições antes de retomar a supervisão.
- O popup é uma notificação nativa de bandeja (`NotifyIcon.ShowBalloonTip`), não um alerta JavaScript. Clicar num resumo real abre a central no WebView2. O teste é explicitamente identificado, abre o aplicativo e não envia mensagem ao backend nem a outras pessoas.
- Não perturbe, acessibilidade e políticas do Windows podem alterar ou suprimir a exibição. Solicitar um popup não comprova leitura; as mensagens continuam na central autenticada.
- Recepção usa os endpoints existentes `/me/notifications` e `/me/notifications/received`, com autenticação no host. Recupera todas as páginas, protege os recibos com DPAPI e separa contas/origens. Não calcula horas ou destinatários localmente.
- A versão instalada pelo script de perfil registra início por usuário com `--background` ao abrir pela primeira vez. O MSI corporativo registra inicialização por máquina em cada logon e o serviço supervisiona a sessão local ativa. O pacote MSIX histórico declara uma tarefa de inicialização do Windows. Builds portáteis e Debug não registram início automático.
- Nas áreas autenticadas, o menu de energia consulta a CEP API. O host nativo repete a verificação, e o serviço aceita somente Desligar, Reiniciar ou Hibernar com atraso fixo de dez segundos. Falha real de transporte permite contingência; respostas HTTP, inclusive erro, não são tratadas como API offline.

## Carregamento e recuperação da interface — MSI 0.4.9

O WPF mantém o WebView oculto e mostra progresso indeterminado enquanto inicializa o runtime, navega e aguarda conteúdo visível do React em `#root`. `NavigationCompleted.IsSuccess` sozinho indica navegação HTML, não a montagem da interface. Sem conteúdo por 30 segundos, o progresso é substituído por uma mensagem e pelo botão central **Recarregar interface**. Uma interface que fique vazia por três verificações consecutivas também oferece recuperação. Falhas de navegação e eventos `ProcessFailed` de browser/renderizador são tratados; falhas de GPU/utility são registradas e deixam a recuperação automática do runtime atuar.

O botão também está sempre acessível no rodapé nativo e pela bandeja. A recarga normal não limpa o perfil nem a sessão protegida. Se o browser principal já morreu ou o runtime nem inicializou, usa a recuperação existente de reinício/perfil; espera pelos processos fora da thread visual. Durante instalação MSI, a ação não inicia outra recuperação.

Os eventos limitados de carregamento, navegação, root vazio, timeout e falha de processo são registrados em `%LOCALAPPDATA%\Conceito\CepHoras\Diagnostics\webview.jsonl`, com rotação acima de 256 KiB. Apenas código/tipo técnico e horário são registrados; não incluir textos da página, URLs, respostas da API, conta ou credenciais. A fixture Debug isola instância, perfil, sessão, recuperação e logs da instalação real.

Diagnóstico de 02/10/2026: havia evento Windows `AppHangB1` no CEP Horas 0.4.7. Na consulta posterior, serviço e processos WebView2 estavam vivos e os assets principais correspondiam ao pacote gerado. O host não tratava falhas de processo e escondia a recuperação apenas pelo sucesso da navegação. A causa inicial do travamento não está comprovada; essas evidências não demonstram que o serviço tenha encerrado o Chromium. O banner de atualizador indisponível pertence a outro fluxo e também não comprova essa hipótese.

## Executar e empacotar

```powershell
pnpm install --frozen-lockfile
pnpm build
dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained false -o .local/package/CEP-Horas-win-x64
```

Executar `.local/package/CEP-Horas-win-x64/CepHoras.exe`. Manter toda a pasta junto ao executável. O pacote exige **.NET Desktop Runtime 10 x64** e **Microsoft Edge WebView2 Runtime**. Release usa `https://api.cep.lat`; não precisa de servidor no computador do usuário. `--test-notification` demonstra o popup localmente; `--background` começa com a janela oculta após inicialização.

O bundle ZIP de teste contém `app/` e `install.ps1`, que instala no perfil Windows e cria atalho, sem substituir instalação existente. Ainda não é uma distribuição assinada. Não confundir o ZIP executável com o MSIX `UNSIGNED`, que serve apenas para inspeção e não deve ser instalado/distribuído.

O instalador corporativo atual é gerado por `./scripts/build-corporate-msi.ps1 -Version 0.4.6`. Ele produz um único MSI self-contained com WPF, WebView2, serviço `CepHorasControl`, políticas de energia, inicialização automática e material de recuperação da TI. O build e a inspeção estrutural não instalam o pacote nem aplicam políticas nesta máquina. Consulte [Instalador corporativo](instalador-corporativo.md).

O host mantém uma única instância por sessão. Quando o serviço já iniciou o CEP Horas em segundo plano, abrir o atalho sinaliza a instância existente e mostra sua janela. Em falha de inicialização ou navegação, o botão **Reiniciar CEP Horas** encerra os processos do próprio host e os subprocessos WebView2 vinculados, move o perfil local para um backup recuperável, inicia um perfil limpo e reabre a janela. O serviço de controle permanece ativo e nenhum outro serviço ou aplicativo do Windows é encerrado.

## Validação e limites

- Build React e publish WPF Release passaram; 21 testes web unitários, lint e 16 verificações do atualizador passaram.
- `node scripts/test-desktop.mjs` executou o WPF/WebView2 real com servidor descartável: login, refresh, DPAPI, 101 pendentes em duas páginas, reinício, navegação para central, fechar para bandeja, encerramento e logout. O evento `BalloonTipShown` confirmou que o Windows exibiu o popup neste PC.
- O driver e o log de eventos nativos desse teste existem somente em Debug com `CEP_DESKTOP_TESTING=1`; não expõem comandos extras no bridge Release.
- Não houve envio a usuários reais, teste autenticado em produção, assinatura de certificado, instalação do MSI corporativo, troca entre duas versões assinadas, merge na `main` ou deploy nesta tarefa. A homologação elevada das políticas, inicialização, relançamento e ações reais continua pendente em VM/máquina piloto.
- A tentativa de gerar MSIX neste PC parou porque o Windows SDK/MakeAppx não está instalado. Foi gerado o pacote ZIP executável; o manifesto de início automático ainda precisa ser validado pelo MakeAppx em um ambiente com SDK.
- A preparação do atualizador foi preservada. Não foi criada uma release pública nem escolhida uma nova política de assinatura.

O código preservado atende somente ao MSIX histórico e não atualiza o MSI corporativo 0.4.6. A arquitetura proposta para atualização elevada por meio do serviço, incluindo bootstrap, assinatura, manutenção e testes, está em [Contexto do atualizador MSI](contexto-atualizador-msi.md).

Referências: [popup da bandeja](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon.showballoontip?view=windowsdesktop-10.0), [tarefa de início MSIX](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-desktop-startuptask).

## Download público — versão de teste

A página `/download` é pública e acessível pelo rodapé do login no navegador. Não solicita autenticação nem consulta a API. Mostra requisitos, uso portátil, instalação opcional, bandeja e a ausência de assinatura/atualização automática no ZIP.

A primeira publicação usa a prerelease `desktop-v0.2.0.1-test`, com `CEP-Horas-Windows.zip` e `SHA256SUMS.txt`. O assembly é publicado com versão `0.2.0.1`. A tag de teste é ignorada pelo atualizador de MSIX; releases assinadas continuam usando `desktop-vX.Y.Z.W` e `CEP-Horas-win-x64.msix`.

Antes de publicar outra versão: gerar Release em diretório novo, incluir a pasta inteira em `app/`, copiar `scripts/install-desktop.ps1` como `install.ps1`, incluir as instruções de uso e gerar SHA-256 do ZIP. Nunca incluir perfis WebView2, sessões, credenciais ou certificados. Publicar os arquivos da tag correspondente e atualizar os links da página no mesmo trabalho.

O site em produção só passa a mostrar a página após o deploy web; criar a release disponibiliza imediatamente o arquivo no GitHub. Esta publicação não instala certificados nem altera os computadores dos destinatários.
