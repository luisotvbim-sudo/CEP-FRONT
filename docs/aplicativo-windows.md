# Aplicativo Windows — WebView2 e popup nativo

Implementação iniciada em 29/09/2026 e integrada ao instalador corporativo em 30/09/2026, na branch `codex/installer-integrado`. Reúne interface, sessão, notificações, controle de energia e instalação por máquina.

## Comportamento

- As telas de login, administração, análises e central pessoal continuam em React, dentro do WebView2. O host WPF cuida da sessão protegida, bandeja, popup e atualização do programa.
- Fechar a janela mantém o processo na bandeja. No MSI corporativo, o serviço relança o processo quando ele é finalizado sem autorização. **Sair da conta**, na interface, revoga a sessão.
- O menu da bandeja oferece **Abrir CEP Horas**, **Minhas notificações**, **Testar notificação** e **Fechar CEP Horas**. O fechamento abre uma janela de senha e aceita somente a data local em `ddMMyy` seguida de `#pec`; a validação é offline, preserva zeros iniciais e nunca registra a senha. Depois da confirmação, o serviço suspende o relançamento daquela sessão até abertura manual, nova sessão ou reinício do serviço.
- O popup é uma notificação nativa de bandeja (`NotifyIcon.ShowBalloonTip`), não um alerta JavaScript. Clicar num resumo real abre a central no WebView2. O teste é explicitamente identificado, abre o aplicativo e não envia mensagem ao backend nem a outras pessoas.
- Não perturbe, acessibilidade e políticas do Windows podem alterar ou suprimir a exibição. Solicitar um popup não comprova leitura; as mensagens continuam na central autenticada.
- Recepção usa os endpoints existentes `/me/notifications` e `/me/notifications/received`, com autenticação no host. Recupera todas as páginas, protege os recibos com DPAPI e separa contas/origens. Não calcula horas ou destinatários localmente.
- A versão instalada pelo script de perfil registra início por usuário com `--background` ao abrir pela primeira vez. O MSI corporativo registra inicialização por máquina em cada logon e o serviço supervisiona a sessão local ativa. O pacote MSIX histórico declara uma tarefa de inicialização do Windows. Builds portáteis e Debug não registram início automático.
- Nas áreas autenticadas, o menu de energia consulta a CEP API. O host nativo repete a verificação, e o serviço aceita somente Desligar, Reiniciar ou Hibernar com atraso fixo de dez segundos. Falha real de transporte permite contingência; respostas HTTP, inclusive erro, não são tratadas como API offline.

## Executar e empacotar

```powershell
pnpm install --frozen-lockfile
pnpm build
dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained false -o .local/package/CEP-Horas-win-x64
```

Executar `.local/package/CEP-Horas-win-x64/CepHoras.exe`. Manter toda a pasta junto ao executável. O pacote exige **.NET Desktop Runtime 10 x64** e **Microsoft Edge WebView2 Runtime**. Release usa `https://api.cep.lat`; não precisa de servidor no computador do usuário. `--test-notification` demonstra o popup localmente; `--background` começa com a janela oculta após inicialização.

O bundle ZIP de teste contém `app/` e `install.ps1`, que instala no perfil Windows e cria atalho, sem substituir instalação existente. Ainda não é uma distribuição assinada. Não confundir o ZIP executável com o MSIX `UNSIGNED`, que serve apenas para inspeção e não deve ser instalado/distribuído.

O instalador corporativo atual é gerado por `./scripts/build-corporate-msi.ps1 -Version 0.4.4`. Ele produz um único MSI self-contained com WPF, WebView2, serviço `CepHorasControl`, políticas de energia, inicialização automática e material de recuperação da TI. O build e a inspeção estrutural não instalam o pacote nem aplicam políticas nesta máquina. Consulte [Instalador corporativo](instalador-corporativo.md).

O host mantém uma única instância por sessão. Quando o serviço já iniciou o CEP Horas em segundo plano, abrir o atalho sinaliza a instância existente e mostra sua janela. Em falha de inicialização ou navegação, o botão **Reiniciar CEP Horas** encerra os processos do próprio host e os subprocessos WebView2 vinculados, move o perfil local para um backup recuperável, inicia um perfil limpo e reabre a janela. O serviço de controle permanece ativo e nenhum outro serviço ou aplicativo do Windows é encerrado.

## Validação e limites

- Build React e publish WPF Release passaram; 21 testes web unitários, lint e 16 verificações do atualizador passaram.
- `node scripts/test-desktop.mjs` executou o WPF/WebView2 real com servidor descartável: login, refresh, DPAPI, 101 pendentes em duas páginas, reinício, navegação para central, fechar para bandeja, encerramento e logout. O evento `BalloonTipShown` confirmou que o Windows exibiu o popup neste PC.
- O driver e o log de eventos nativos desse teste existem somente em Debug com `CEP_DESKTOP_TESTING=1`; não expõem comandos extras no bridge Release.
- Não houve envio a usuários reais, teste autenticado em produção, assinatura de certificado, instalação do MSI corporativo, troca entre duas versões assinadas, merge na `main` ou deploy nesta tarefa. A homologação elevada das políticas, inicialização, relançamento e ações reais continua pendente em VM/máquina piloto.
- A tentativa de gerar MSIX neste PC parou porque o Windows SDK/MakeAppx não está instalado. Foi gerado o pacote ZIP executável; o manifesto de início automático ainda precisa ser validado pelo MakeAppx em um ambiente com SDK.
- A preparação do atualizador foi preservada. Não foi criada uma release pública nem escolhida uma nova política de assinatura.

Referências: [popup da bandeja](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon.showballoontip?view=windowsdesktop-10.0), [tarefa de início MSIX](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-desktop-startuptask).

## Download público — versão de teste

A página `/download` é pública e acessível pelo rodapé do login no navegador. Não solicita autenticação nem consulta a API. Mostra requisitos, uso portátil, instalação opcional, bandeja e a ausência de assinatura/atualização automática no ZIP.

A primeira publicação usa a prerelease `desktop-v0.2.0.1-test`, com `CEP-Horas-Windows.zip` e `SHA256SUMS.txt`. O assembly é publicado com versão `0.2.0.1`. A tag de teste é ignorada pelo atualizador de MSIX; releases assinadas continuam usando `desktop-vX.Y.Z.W` e `CEP-Horas-win-x64.msix`.

Antes de publicar outra versão: gerar Release em diretório novo, incluir a pasta inteira em `app/`, copiar `scripts/install-desktop.ps1` como `install.ps1`, incluir as instruções de uso e gerar SHA-256 do ZIP. Nunca incluir perfis WebView2, sessões, credenciais ou certificados. Publicar os arquivos da tag correspondente e atualizar os links da página no mesmo trabalho.

O site em produção só passa a mostrar a página após o deploy web; criar a release disponibiliza imediatamente o arquivo no GitHub. Esta publicação não instala certificados nem altera os computadores dos destinatários.
