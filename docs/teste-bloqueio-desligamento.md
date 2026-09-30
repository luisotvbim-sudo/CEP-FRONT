# Teste local de autorização de desligamento

MSI 0.2.7 adiciona um experimento opcional no host WPF. Não depende do login, da API nem da tolerância de horas. A regra deste teste é pedir a senha em toda tentativa normal de desligar ou reiniciar enquanto o aplicativo configurado estiver aberto.

## Ativação somente para a conta atual

No PowerShell 7, execute `./scripts/configure-shutdown-test.ps1`, informe a senha temporária na entrada protegida e reinicie o CEP Horas. A faixa laranja confirma que o teste está ativo. Sem configuração, o comportamento anterior é mantido. Configuração ilegível ou falha ao registrar o bloqueio gera aviso explícito de teste INATIVO.

A senha não é embutida no executável, no MSI, no React ou no Git. O arquivo `%LOCALAPPDATA%\Conceito\CepHoras\shutdown-test.dat` contém um verificador PBKDF2-SHA256, com salt aleatório e 600.000 iterações, protegido por DPAPI CurrentUser. É uma senha local de teste; não valida administrador do Windows/domínio e não é um controle contra o proprietário da conta.

## Teste manual

1. Salve o trabalho em outros programas: o Windows pode fechar outros aplicativos antes de consultar o CEP Horas.
2. Solicite **Desligar** pelo Windows. Se aparecer a tela de aplicativos impedindo o desligamento, escolha **Cancelar** para voltar à área de trabalho.
3. No CEP Horas, informe a senha. Senha incorreta, cancelar ou fechar o diálogo mantém o bloqueio. O campo é limpo após cada tentativa.
4. Senha correta autoriza por **60 segundos**. Solicite **Desligar** novamente pelo Windows dentro desse prazo. O aplicativo nunca inicia desligamento por conta própria.
5. Se outra aplicação cancelar a tentativa autorizada, o CEP Horas continua aberto e rearma a exigência. Ao expirar o prazo, a exigência também retorna. A autorização não persiste ao reiniciar o aplicativo.

O botão **Autorizar desligamento…** da faixa permite conferir a senha antecipadamente sem tentar desligar o Windows.

Para encerrar o experimento: `./scripts/configure-shutdown-test.ps1 -Disable` e reinicie o aplicativo. O comando remove somente a configuração do teste; não toca na sessão da API.

## Limites

- É um veto cooperativo com `WM_QUERYENDSESSION` e `ShutdownBlockReasonCreate`. A mesma mensagem cobre desligar e reiniciar; não distingue os dois.
- Não bloqueia logoff, encerramento forçado, manutenção do Restart Manager, botão físico mantido pressionado ou falta de energia. O Windows pode oferecer **Desligar mesmo assim**.
- Não instala serviço supervisor, não impede finalizar o processo, sair pela bandeja, alterar os arquivos do próprio usuário ou desinstalar. Não é a política administrativa definitiva discutida para o domínio.
- Nenhum endpoint ou permissão de backend foi criado. Vincular o bloqueio ao usuário autenticado e às divergências/tolerância exige uma etapa funcional separada.

## Validação automatizada

`dotnet run --project desktop/CepHoras.Shutdown.Tests -c Release` executa uma janela descartável e mensagens direcionadas somente aos HWNDs do próprio teste, nunca broadcast ou comandos de desligamento. Cobre bloqueio/liberação nativos, senha errada/correta na janela real, expiração, cancelar diálogo, cancelar desligamento, flags logoff/critical/maintenance, descarte e configuração DPAPI inválida/ausente/válida.

O host intercepta também a janela interna do WPF: por padrão o WPF encerra a aplicação já em `WM_QUERYENDSESSION`. O teste assegura que uma consulta autorizada não encerra prematuramente o processo, aguardando `WM_ENDSESSION(TRUE)`.

Referências: [WM_QUERYENDSESSION](https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-queryendsession), [WM_ENDSESSION](https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-endsession), [ShutdownBlockReasonCreate](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-shutdownblockreasoncreate).

## Validação local — 30/09/2026

MSI 0.2.7 instalado com retorno 0 e contexto Windows Installer 2 (por usuário, sem elevação). Aplicativo reaberto e WebView2 ativo; ShutdownBlockReasonQuery confirmou o motivo de bloqueio registrado no HWND real instalado. Testes de mensagens nativas/janela de senha e regressão WPF/WebView2 com fixture passaram. Não foi solicitado desligamento real; o teste manual no Windows fica com o usuário.

Pacote em Downloads/CEP-Horas-MSI-0.2.7. SHA-256: 80f2cae5fa540f41533587f279294c31aa05ec3cb46235e8fb4c4f7ce519ce0d.
