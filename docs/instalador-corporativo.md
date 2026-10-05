# Instalador corporativo do CEP Horas

Reconciliado em 04/10/2026. Este guia descreve o MSI por máquina, serviço e políticas. Use o [contexto do instalador](CONTEXTO-INSTALADOR.md) para identificar a branch antes de construir ou distribuir.

## Qual base usar

| Base conferida | Script de build | Escopo disponível |
|---|---|---|
| `main` `eb63dbdc7f7bf83d0a4b51ee5567ed5aa80c138c` | Padrão 0.4.3 | Instalação corporativa, PIN/energia, instância única e recuperação completa do WebView2. |
| `codex/installer-integrado` `dc58bde1617e6e1af6b61bea87c87fb5da9366a9` | Padrão 0.4.6 | Inclui fechamento diário protegido e restauração/retomada das políticas. |
| `codex/msi-auto-updater` `95fbf5c4ff982916edacba5406d4b569d8007be8` | Padrão 0.4.7 | Inclui atualizador MSI assinado; 0.4.8 é o piloto seguinte e 0.4.9 acrescenta recuperação/carregamento nativos. [PR #9](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/9). |

O atualizador está implementado na terceira base e não na main analisada. A presença deste guia numa branch não altera o código daquele checkout. Versão de artefato não comprova release publicada ou instalada; o SHA e o parâmetro de build precisam ser registrados juntos.

## Pacote e componentes

O pacote `CEP-Horas-Windows-win-x64.msi` instala em `C:\Program Files\Conceito CEP Horas`, no escopo da máquina, com autorização administrativa inicial. Ele reúne React/assets locais, host WPF self-contained, serviço `CepHorasControl`, inicialização em logon, atalhos e mecanismo de recuperação. WebView2 Runtime é requisito da máquina; não distribuir somente o executável sem seu payload.

O serviço roda como `LocalSystem`. ACLs restringem gravação na instalação e no estado privilegiado a Administradores/SYSTEM; usuário comum não recebe direito de parar/configurar o serviço. O pipe nega rede e valida SID interativo e o caminho do `CepHoras.exe` instalado antes de aceitar o protocolo fixo. Não existe execução genérica de comando, URL ou arquivo fornecido pelo usuário.

O MSI conserva `ProductName=CEP Horas`, `Manufacturer=Conceito`, plataforma x64, `ALLUSERS=1` e `UpgradeCode=8D0D0DC8-E744-42E7-A57A-20F489145ED8`. `MajorUpgrade` rejeita downgrade. Não trocar essas identidades numa correção comum: isso modifica descoberta, upgrade, desinstalação e confiança.

O aplicativo usa instância única por sessão Windows. Abrir o atalho sinaliza a instância existente e apresenta a janela; não inicia outra instância para disputar o perfil WebView2. Fechar a janela envia para a bandeja. A sessão da API continua no host, com DPAPI `CurrentUser`; React e serviço não recebem tokens.

## Política de energia

Antes da primeira alteração, o controle salva um snapshot dos direitos e valores afetados, em armazenamento privado de Administradores/SYSTEM. A aplicação é transacional, verifica o resultado e conserva caminhos de rollback/restauração.

| Configuração | Estado corporativo aplicado |
|---|---|
| `SeShutdownPrivilege` e `SeRemoteShutdownPrivilege` | Desde 0.4.12, atribuições originais preservadas; versões anteriores restringiam a Administradores/SYSTEM. |
| `HidePowerOptions` | Ativo no escopo da máquina. |
| Desligamento sem login | Desabilitado. |
| Botão físico curto de energia, botão de sono e tampa | Não fazer nada, em AC e bateria. |

O WPF trata encerramento de sessão não autorizado de usuário comum. A API autoriza a ação pessoal e o WPF revalida; o serviço agenda dez segundos e permite cancelamento, conforme [menu de energia](menu-energia.md).

O controle exige Windows cliente x64, build ≥26100 e famílias de edição Professional/Enterprise/Education. Isso corresponde a Windows 11 24H2 ou posterior nessas edições. Windows 10, Home e Server não estão suportados pelo controle analisado. A condição x64 do MSI não substitui a validação mais estrita feita por `PolicyStore` ao aplicar políticas.

Pressão prolongada do botão, corte de energia, firmware, administrador/SYSTEM, GPO de domínio e operações críticas do Windows ficam fora da garantia. O pacote não desativa UAC/antivírus nem modifica o domínio. Conferir efeitos de GPO e Windows Update no piloto; não inferir resistência a políticas externas.

## Fechamento protegido e retomada

Esta capacidade está nas bases integrada/atualizador e não na main 0.4.3. **Fechar CEP Horas**, no menu da bandeja, pede uma verificação diária local calculada pelo relógio Windows. Ela funciona offline, é distinta do PIN de seis dígitos administrado pela API e não é uma credencial de alta segurança. Sua fórmula/valor não pertence a este documento, capturas ou logs.

O WPF valida o campo e envia a operação restrita de suspensão. O serviço primeiro restaura o snapshot original das políticas e notifica o shell; somente com sucesso suspende o relançamento para o SID/sessão e permite ao host fechar. Se a restauração falhar, o host permanece aberto. A suspensão é por sessão, mas os direitos/registros restaurados têm escopo de máquina: não prometer isolamento desse efeito entre sessões simultâneas.

Desde [0.4.12](liberacao-energia-0.4.12.md), por escolha explícita do usuário, os direitos originais de logon são preservados. O bloqueio controla menus e botões por registros; permite comandos externos que usam direitos existentes. Fechar restaura esses registros e pede atualização do shell. Abrir manualmente, reinício do serviço e eventos de sessão reaplicam os registros e a supervisão sem retirar direitos de logon. Uma sessão que perdeu a permissão com a versão antiga precisa sair/entrar uma vez; o host informa essa condição sem encerrar a sessão automaticamente. GPO e restrições anteriores são preservadas.

Na branch do atualizador, manutenção MSI usa estado separado e nunca restaura políticas pelo fechamento protegido. Durante manutenção, a suspensão manual e novas ações de energia são recusadas.

## Recuperação da interface

Desde 0.4.3, **Reiniciar CEP Horas** encerra somente processos CEP Horas da sessão e subprocessos WebView2 vinculados à instância, preserva o perfil anterior como backup e inicia perfil limpo. O serviço permanece ativo para supervisão/proteção; não encerra serviços genéricos do Windows nem executa energia.

Na evolução 0.4.9 da branch do atualizador, o WPF mostra carregamento até detectar conteúdo visível em `#root`. Navegação HTML bem-sucedida sozinha não é suficiente. Timeout de 30 segundos, root vazio após carregamento e falhas do renderizador oferecem **Recarregar interface** na recuperação, rodapé e bandeja. A recarga preserva perfil/sessão; se o navegador precisa ser recriado, usa a recuperação completa. Esperas de encerramento não bloqueiam a thread visual.

Os eventos técnicos limitados ficam em `%LOCALAPPDATA%\Conceito\CepHoras\Diagnostics\webview.jsonl`, com rotação limitada e sem URLs, texto de página, credenciais ou dados de conta. O perfil fica em `%LOCALAPPDATA%\Conceito\CepHoras\WebView2`; preservar backup em recuperação assistida. Não divulgar o perfil ou arquivos DPAPI em Issues. Este mecanismo melhora detecção/recuperação, mas não prova a causa da tela branca reportada nem resolve automaticamente um banner de atualizador indisponível.

## Construção

Pré-requisitos: Node/pnpm conforme README, .NET SDK 10, Windows/PowerShell e dependências WiX do projeto. Conferir branch, SHA, diretório e versão antes de executar. Exemplos para as bases sem atualizador:

```powershell
# Executar somente no checkout main 0.4.3.
./scripts/build-corporate-msi.ps1 -Version 0.4.3
```

```powershell
# Executar somente no checkout integrado 0.4.6.
./scripts/build-corporate-msi.ps1 -Version 0.4.6
```

Na branch do atualizador, construir bootstrap/piloto com a identidade de publicação aprovada, seguindo [build e assinatura](atualizador-msi.md). Esses parâmetros/scripts de assinatura não estão presentes em todas as bases. Sem assinatura válida, o pacote não está pronto para o canal automático.

Artefatos ficam em `.local/corporate-msi/<versão>/artifacts`; o script recusa substituir saída existente silenciosamente. Preservar pacotes produzidos e hashes; nova versão não deve mudar bytes de uma release anterior. Registrar o commit do build sem incluir chaves, sessão ou dados pessoais.

O ZIP de teste instalado por `install-desktop.ps1`, a execução portátil e o MSIX são canais separados. O teste local não se converte automaticamente em MSI corporativo. O fluxo MSIX usa identidade/certificado e não instala o serviço deste pacote; seus testes não comprovam o atualizador MSI.

## Upgrade, remoção e recuperação administrativa

O upgrade mantém políticas e troca payload/serviço. Na base do atualizador, ações de aplicação/rollback de políticas pertencem à instalação inicial; restauração na remoção exige `NOT UPGRADINGPRODUCTCODE`. Não liberar controles de energia como efeito colateral de `MajorUpgrade`.

Neste piloto, a desinstalação comum aguarda `StopServices`, prepara o journal de rollback e restaura/verifica as políticas antes de `RemoveFiles` e da remoção do serviço. O journal residual validado é conservado para recuperação/reinstalação; não depende de executar o EXE após a remoção. Não apagar o snapshot manualmente: ele conserva o estado anterior necessário à recuperação. Os artefatos da TI incluem instruções/ferramenta administrativa do pacote; usar somente o mecanismo da base instalada e conservar evidência de retorno. Administradores/SYSTEM continuam disponíveis para recuperação. Veja os limites no [relatório do piloto 0.4.10](refatoracao-servico-msi.md).

Antes de implantar o front/PIN, o backend correspondente precisa ter migration versionada, backup validado e PIN provisionado interativamente. Instruções operacionais do servidor pertencem ao CEP-API/CEP-VM; a documentação do instalador não comprova que essas operações estão atuais em produção.

## Verificação e aceite

Fontes comuns: [Package.wxs](../desktop/CepHoras.CorporateInstaller/Package.wxs), [build](../scripts/build-corporate-msi.ps1), [teste estrutural](../scripts/test-corporate-msi.ps1), [PolicyStore](../desktop/CepHoras.Control/PolicyStore.cs), [ControlService](../desktop/CepHoras.Control/ControlService.cs), [PowerAuthority](../desktop/CepHoras.Control/PowerAuthority.cs). Fontes específicas: [ciclo de fechamento integrado](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/dc58bde1617e6e1af6b61bea87c87fb5da9366a9/desktop/CepHoras.Control/DesktopLifecycleController.cs) e [recarga 0.4.9](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Desktop/MainWindow.WebView.cs).

Testes puros do serviço usam executor falso; inspeção MSI lê o banco sem instalar. Compilação/CI, mocks e inspeção estrutural são evidências distintas da homologação Windows. Esta revisão documental não executou novas suítes ou ações reais.

O piloto da [Issue #7](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/7) deve registrar instalação com administrador e uso com conta comum; políticas em Iniciar/Alt+F4/login/botão curto/tampa; login/retomada; decisões e PIN/expiração; três ações/cancelamento; fechamento/retomada e múltiplas sessões; WebView2; upgrade e desinstalação/restauração. O piloto do atualizador acrescenta os critérios do [guia MSI](atualizador-msi.md).

Conferir a frota e edições pela [Issue #11](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/11), validar recuperação 0.4.9 pela [Issue #12](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/12) e só ampliar de VM para PC piloto, duas/três máquinas e restante da equipe depois de resultados verificáveis. Nenhuma versão instalada ou rollout está sendo declarado concluído por este guia.
