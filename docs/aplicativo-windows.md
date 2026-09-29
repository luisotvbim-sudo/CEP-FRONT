# Aplicativo Windows — WebView2 e popup nativo

Implementação local de 29/09/2026, na branch `codex/windows-popup`. Reúne a interface e a recepção de notificações da `main` com a preparação de instalação/atualização da branch `codex/desktop-local-installer`.

## Comportamento

- As telas de login, administração, análises e central pessoal continuam em React, dentro do WebView2. O host WPF cuida da sessão protegida, bandeja, popup e atualização do programa.
- Fechar a janela mantém o processo na bandeja. **Sair do aplicativo** encerra o processo e os avisos; não revoga a sessão salva. **Sair da conta**, na interface, revoga a sessão.
- O menu da bandeja oferece **Abrir CEP Horas**, **Minhas notificações**, **Testar notificação** e **Sair do aplicativo**.
- O popup é uma notificação nativa de bandeja (`NotifyIcon.ShowBalloonTip`), não um alerta JavaScript. Clicar num resumo real abre a central no WebView2. O teste é explicitamente identificado, abre o aplicativo e não envia mensagem ao backend nem a outras pessoas.
- Não perturbe, acessibilidade e políticas do Windows podem alterar ou suprimir a exibição. Solicitar um popup não comprova leitura; as mensagens continuam na central autenticada.
- Recepção usa os endpoints existentes `/me/notifications` e `/me/notifications/received`, com autenticação no host. Recupera todas as páginas, protege os recibos com DPAPI e separa contas/origens. Não calcula horas ou destinatários localmente.
- A versão instalada pelo script registra início por usuário com `--background` ao abrir pela primeira vez. O pacote MSIX declara uma tarefa de inicialização do Windows. Builds portáteis e Debug não registram início automático. O Windows pode desativar a inicialização conforme suas políticas.

## Executar e empacotar

```powershell
pnpm install --frozen-lockfile
pnpm build
dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained false -o .local/package/CEP-Horas-win-x64
```

Executar `.local/package/CEP-Horas-win-x64/CepHoras.exe`. Manter toda a pasta junto ao executável. O pacote exige **.NET Desktop Runtime 10 x64** e **Microsoft Edge WebView2 Runtime**. Release usa `https://api.cep.lat`; não precisa de servidor no computador do usuário. `--test-notification` demonstra o popup localmente; `--background` começa com a janela oculta após inicialização.

O bundle ZIP de teste contém `app/` e `install.ps1`, que instala no perfil Windows e cria atalho, sem substituir instalação existente. Ainda não é uma distribuição assinada. Não confundir o ZIP executável com o MSIX `UNSIGNED`, que serve apenas para inspeção e não deve ser instalado/distribuído.

## Validação e limites

- Build React e publish WPF Release passaram; 21 testes web unitários, lint e 16 verificações do atualizador passaram.
- `node scripts/test-desktop.mjs` executou o WPF/WebView2 real com servidor descartável: login, refresh, DPAPI, 101 pendentes em duas páginas, reinício, navegação para central, fechar para bandeja, encerramento e logout. O evento `BalloonTipShown` confirmou que o Windows exibiu o popup neste PC.
- O driver e o log de eventos nativos desse teste existem somente em Debug com `CEP_DESKTOP_TESTING=1`; não expõem comandos extras no bridge Release.
- Não houve envio a usuários reais, teste autenticado em produção, assinatura de certificado, instalação MSIX, troca entre duas versões assinadas, merge na `main` ou deploy nesta tarefa. A homologação de inicialização após login do Windows e do MSIX continua pendente.
- A tentativa de gerar MSIX neste PC parou porque o Windows SDK/MakeAppx não está instalado. Foi gerado o pacote ZIP executável; o manifesto de início automático ainda precisa ser validado pelo MakeAppx em um ambiente com SDK.
- A preparação do atualizador foi preservada. Não foi criada uma release pública nem escolhida uma nova política de assinatura.

Referências: [popup da bandeja](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon.showballoontip?view=windowsdesktop-10.0), [tarefa de início MSIX](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-desktop-startuptask).

## Download público — versão de teste

A página `/download` é pública e acessível pelo rodapé do login no navegador. Não solicita autenticação nem consulta a API. Mostra requisitos, uso portátil, instalação opcional, bandeja e a ausência de assinatura/atualização automática no ZIP.

A primeira publicação usa a prerelease `desktop-v0.2.0.1-test`, com `CEP-Horas-Windows.zip` e `SHA256SUMS.txt`. O assembly é publicado com versão `0.2.0.1`. A tag de teste é ignorada pelo atualizador de MSIX; releases assinadas continuam usando `desktop-vX.Y.Z.W` e `CEP-Horas-win-x64.msix`.

Antes de publicar outra versão: gerar Release em diretório novo, incluir a pasta inteira em `app/`, copiar `scripts/install-desktop.ps1` como `install.ps1`, incluir as instruções de uso e gerar SHA-256 do ZIP. Nunca incluir perfis WebView2, sessões, credenciais ou certificados. Publicar os arquivos da tag correspondente e atualizar os links da página no mesmo trabalho.

O site em produção só passa a mostrar a página após o deploy web; criar a release disponibiliza imediatamente o arquivo no GitHub. Esta publicação não instala certificados nem altera os computadores dos destinatários.
