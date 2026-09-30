# Aplicativo Windows — WebView2 e popup nativo

> Nova linha separada: [MSI corporativo piloto 0.3.0](instalador-corporativo.md), com serviço LocalSystem e ativação administrativa de restrições locais. O MSI básico descrito abaixo continua sendo o produto por usuário/todos sem esse serviço. A homologação elevada do corporativo fica com a TI.

## MSI básico de teste — 30/09/2026

O MSI empacota o aplicativo atual, incluindo as atualizações da `main` até `7237178`. O código do aplicativo, o contrato e a autenticação não foram alterados para este empacotamento.

- Windows x64; desde 0.2.3, o mesmo MSI oferece **Somente para mim** (padrão, `%LOCALAPPDATA%\Programs\Conceito\CEP Horas Teste MSI`, sem elevação) ou **Todos os usuários** (`C:\Program Files\Conceito\CEP Horas Teste MSI`, com elevação). Políticas corporativas podem impedir instalações por usuário.
- Atalho `CEP Horas (Teste MSI)` no menu Iniciar e entrada com esse nome em Aplicativos instalados.
- Desde 0.2.4, a tela final traz **Abrir CEP Horas** marcado por padrão. Ao clicar em Concluir após uma instalação bem-sucedida, `WixUnelevatedShellExec` abre o executável instalado no contexto normal do desktop. Desmarcar evita a abertura; reparo, remoção e instalação silenciosa não iniciam o aplicativo. Se o shell não estiver disponível ou a abertura falhar, o aplicativo continua disponível pelo atalho; a instalação concluída não é revertida.
- Runtime .NET incluído (`self-contained`); Microsoft Edge WebView2 Runtime continua sendo requisito separado.
- API padrão de produção: `https://api.cep.lat`. Não contém credenciais nem perfis locais. Testes autenticados precisam de conta/organização apropriadas e afetam dados reais.
- Sem assinatura; não instala certificados, não muda GPO nem desativa proteções. Políticas da empresa podem exigir autorização específica pela TI.
- Não instala o serviço supervisor nem restringe a saída. Desde 0.2.7 há [teste local opcional de senha no desligamento](teste-bloqueio-desligamento.md), sem garantia contra encerramento forçado; a política administrativa definitiva permanece pendente.
- Sem inicialização automática e sem atualização automática neste MSI. O atualizador MSIX permanece inativo, pois este pacote não contém marcador/manifesto MSIX.
- Não remove ZIP/MSIX anterior; não executar as versões simultaneamente, pois a sessão protegida por usuário é compartilhada.
- Desde 0.2.5, conflito com outra instância mostra uma orientação específica para encerrar a versão anterior pela bandeja e um botão **tentar novamente**. A proteção do arquivo de sessão é mantida; a nova instância não apaga a sessão nem encerra a anterior à força.
- Fechar pela opção **Sair do aplicativo** antes de atualizar/remover. A desinstalação preserva dados no perfil Windows; para revogar a sessão, usar **Sair da conta** antes de remover.

Construção (PowerShell, Node/pnpm e .NET SDK 10):

```powershell
pnpm install --frozen-lockfile
./scripts/build-desktop-msi.ps1 -Version 0.2.7
```

Saída: `.local/msi/0.2.7/artifacts/CEP-Horas-Teste-win-x64.msi`, `SHA256SUMS.txt` e `LEIA-ME.txt`. O script exige uma saída nova, publica o React/WPF em diretório limpo e empacota apenas esse publish. O WiX SDK e as extensões UI/Util estão fixados em 5.0.2 para este protótipo; rever a versão suportada e os termos da ferramenta antes de estabelecer o pipeline de produção. O toolchain é obtido pelo NuGet, sem instalação global.

O gerador `new-msi-payload.ps1` usa identificadores estáveis por caminho e keypaths HKMU, que seguem o escopo escolhido (HKCU/HKLM). Atalhos também seguem o contexto MSI. Para instalação silenciosa, usar `ALLUSERS=2 MSIINSTALLPERUSER=1` (usuário) ou `ALLUSERS=2 MSIINSTALLPERUSER=""` (computador). Manter o mesmo escopo ao atualizar; troca de escopo exige remover a instalação anterior. A edição por usuário pode ser removida pelo próprio usuário e não implementa o controle administrativo da futura versão com serviço.

Versões MSI têm três números, com limites `255.255.65535`. O UpgradeCode desta linha de teste é estável; versões maiores substituem a instalação anterior, a substituição participa do rollback, e versões menores são bloqueadas. Não representa atualização automática.

Homologação na máquina de teste: testar os dois escopos (com autorização da TI na opção para todos), abrir como usuário comum, fazer login manual, testar popup na bandeja, fechar/minimizar/reabrir, sair da conta e remover em Aplicativos instalados. Repetir com uma versão maior no mesmo escopo para validar upgrade e tentativa de downgrade. Nenhuma instalação administrativa ou alteração de domínio deve ser inferida de uma compilação bem-sucedida.

Validação 0.2.3: build e ICE sem erros/avisos; 491 arquivos extraídos do MSI com SHA-256 igual ao publish. `scripts/test-desktop-msi.ps1` simula o cálculo de diretórios e os eventos reais da tela de escopo no Windows Installer, sem instalar: confirmou pasta local/menu pessoal para usuário e Program Files/menu comum para todos. Não houve instalação/desinstalação nem teste visual interativo do assistente nesta versão. SHA-256: `447d863976cda3f9211ee3b15cee56e32d566678b9db030d4304317b5ccc2461`. Entrega local: Downloads/CEP-Horas-MSI-0.2.3.

Validação 0.2.4: build/ICE sem avisos ou erros. A simulação do MSI confirmou ambos os escopos e, em cada um, abertura habilitada por padrão e desabilitada ao desmarcar, reparar ou remover. Conferidos alvo `AppExe`, ação `WixUnelevatedShellExec` e ausência da ação na sequência silenciosa de instalação. Não houve instalação real nem acionamento do executável pelo assistente nesta entrega. SHA-256: `e403f90dbe97b024bed801b47255e9c7cdeb15e435d5721c0bb16a1632ef5c86`. Entrega local: Downloads/CEP-Horas-MSI-0.2.4.

Diagnóstico em 30/09: a instalação 0.2.4 feita pelo usuário continha os mesmos 491 arquivos do publish (hashes iguais), mas a versão ZIP antiga ainda estava executando e o lock da sessão retornava Windows 32 (sharing violation). Esse erro anteriormente caía no aviso genérico de inicialização/API. O teste WPF/WebView2 foi ampliado para abrir uma segunda instância e confirmou o estado específico de sessão em uso, preservação do arquivo DPAPI e ausência de refresh adicional; os testes de retomada, notificações e logout também passaram. O botão de nova tentativa não foi acionado manualmente nesta validação.

MSI 0.2.5 gerado e validado por ICE e testes de escopo/abertura sem erros, entregue em Downloads/CEP-Horas-MSI-0.2.5. SHA-256: `614611a051717d70c13af27c9433536c3cf4234b4a27847f872baf440e2e7bf0`. A instalação existente e o processo ZIP do usuário foram preservados; encerrar a versão antiga pela bandeja libera a sessão para o MSI.

Validação do pacote 0.2.2: build React, publish Release self-contained e compilação/validação ICE do MSI concluídos sem avisos ou erros. Extraídos os 491 arquivos do MSI e comparados por SHA-256 com o publish; todos coincidem. Banco MSI inspecionado: `ALLUSERS=1`, versão `0.2.2`, atalho anunciado para a feature principal e ausência de `ServiceInstall`. Pacote sem assinatura, 62.956.172 bytes. SHA-256: `7c0fd9d4b4187c477ab1d8958bd2c4dc64b6f645464210a1d755066134bddc06`.

Não foi executada instalação/remoção elevada, atualização entre versões ou login de produção nesta entrega. O aplicativo ZIP já estava aberto no computador; ele foi preservado. O MSI foi entregue localmente em Downloads, sem publicação de release ou alteração do link público de download. Atualizações de segurança do .NET incluído exigem republicar o MSI.

O restante deste documento registra as entregas anteriores em ZIP/MSIX; seus requisitos de .NET instalado à parte não se aplicam ao MSI self-contained acima.

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

### Teste local MSI 0.2.6

Instalação por usuário concluída sem elevação (msiexec: 0). O Windows Installer confirmou Context=2 (per-user unmanaged); a versão 0.2.4 anterior foi substituída pelo upgrade no mesmo contexto. A consulta apenas à chave Uninstall em HKLM não determina o escopo real do MSI.

Desde 0.2.6, o destino por usuário é %LOCALAPPDATA%\Programs\Conceito\CEP Horas Teste MSI. Pacote validado por ICE e testes de escopo/abertura. Atalho pessoal confirmado, executável 0.2.6.0 iniciado a partir da pasta instalada e processo WebView2 presente. Validação visual/login real fica para o usuário.

Entrega local: Downloads/CEP-Horas-MSI-0.2.6. SHA-256: 094f2fb06363b21e383cdb808f86b3caa14ba1fc98b334ef14db5847d8193c81.
