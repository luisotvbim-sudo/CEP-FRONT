# Instalador corporativo — piloto local 0.3.0

Solicitação de 30/09/2026: instalar com autorização administrativa, retirar o desligamento nativo do usuário comum e oferecer a operação no CEP Horas mediante regra. O pacote anterior 0.2.7 era apenas veto cooperativo e podia ser ignorado pelo Windows; esta linha corporativa é um produto MSI separado.

## Entrega

- MSI `CEP-Horas-Corporativo-Piloto-win-x64.msi`: exclusivamente por máquina, arquivos em `C:\Program Files\Conceito CEP Horas Corporativo`, ACL protegida de leitura/execução para usuários, atalhos comuns e início da interface por logon.
- Serviço `CepHorasControl`: LocalSystem, automático, recuperação após falha, administração via permissões normais do SCM (usuário comum sem parada/configuração).
- Ao concluir o MSI, opção marcada abre **Configuração TI**; a ferramenta se eleva por UAC quando necessário. Ela exige senha nova com 8–128 caracteres, confirmação e revisão do escopo antes de aplicar restrições. Instalação silenciosa não ativa políticas: executar a ferramenta depois.
- **Solicitar desligamento** no host WPF chama o serviço por named pipe local. Senha correta e confirmação explícita solicitam desligamento em 30 segundos, sem forçar fechamento de aplicações com dados não salvos. Quem solicitou pode cancelar dentro do prazo.
- ZIP para a TI: MSI, instruções, checksum e `RecuperacaoTI`, contendo uma cópia self-contained da ferramenta administrativa, independente de WebView2/API/instalação íntegra.

**Regra piloto:** senha local definida pela TI. Não há decisão por tolerância, usuário da CEP API ou vínculo com identidade Windows nesta entrega; nenhum endpoint foi inventado. A integração da regra definitiva e de uma autorização administrativa auditável no backend é uma etapa posterior. Não armazenar senha de domínio nesta configuração.

## Políticas alteradas somente após ativação

`SeShutdownPrivilege` e `SeRemoteShutdownPrivilege` passam a SYSTEM e Administradores. A configuração original de cada direito é salva antes da primeira escrita. Os valores de registro originais (incluindo ausência) também são preservados:

| Local HKLM | Valor aplicado |
| --- | --- |
| `Software\Microsoft\Windows\CurrentVersion\Policies\Explorer` | `HidePowerOptions=1` |
| `Software\Microsoft\Windows\CurrentVersion\Policies\System` | `ShutdownWithoutLogon=0` |
| `Software\Policies\Microsoft\Power\PowerSettings\7648efa3-dd9c-4e3e-b566-50f929386280` | `ACSettingIndex=0`, `DCSettingIndex=0` |

O piloto exige Windows 11 Pro/Enterprise/Education 24H2 com KB5062660 ou superior, pois a política de comandos de energia no escopo de computador requer essa atualização. O menu também é ocultado para a TI, que conserva os direitos e a ferramenta administrativa. O toque curto do botão físico recebe a política Não fazer nada; validar sua aplicação no hardware/plano de energia. Pressão física prolongada e corte de energia não podem ser bloqueados por este produto.

É obrigatório sair e entrar novamente nas sessões existentes para renovar os privilégios. Políticas de domínio podem substituir as locais; o serviço detecta divergência nos valores monitorados e avisa, não reaplica a configuração em disputa com GPO. Isso não garante manter a restrição se uma GPO devolver direitos ao usuário. Homologar após `gpupdate` e novo logon antes de adotar.

## Segurança e recuperação

- Não há senha padrão/embutida. Verificador PBKDF2-SHA256, 600.000 iterações, salt aleatório; configuração e backup sob `%ProgramData%\Conceito.CepHoras.Control`, acessíveis apenas a SYSTEM/Administradores. Nenhuma senha vai para propriedades/logs do MSI ou para o React.
- ACL do pipe nega acesso de rede e permite clientes interativos locais sem direito de criar instâncias. O serviço obtém o SID do token do Windows; ignora qualquer identidade declarada no JSON. O cliente confere o PID do servidor contra o SCM antes de enviar senha e usa identificação, sem delegar impersonação plena.
- Protocolo com tamanho máximo de 4 KiB, tempo limite e lista fixa `status`, `shutdown`, `cancel`. Não executa comandos, caminhos ou argumentos fornecidos por clientes. Cinco erros por usuário impõem espera de um minuto. Logs guardam somente SID, horário e códigos de decisão.
- Serviço indisponível, configuração ausente/inválida ou divergência de política não autorizam desligamento. A interface permanece aberta para explicar a falha; a TI conserva restauração administrativa independente.
- Ativação escreve o backup antes da primeira mudança e restaura em caso de falha. Falha na própria recuperação mantém backup/estado pendente para recuperação explícita. Operações administrativas usam lock exclusivo.
- Desinstalação executa restauração elevada **antes** de parar o serviço/remover arquivos e inclui rollback do estado anterior à remoção. Se uma política ativa divergir do esperado, a remoção falha para a TI revisar e restaurar explicitamente. Upgrade preserva estado. Backup e auditoria são preservados após remoção.
- A ferramenta permite **Restaurar configurações anteriores** mesmo se a interface principal/API não estiver disponível. Alternativa elevada: `CepHoras.Control.exe --restore-policy`; código 0 confirma término. A mesma opção funciona na pasta `RecuperacaoTI` extraída integralmente do ZIP.

Não aplicar em controladores de domínio/servidores. Não modifica domínio, não desativa UAC/antivírus, não instala certificado e não impede ações de TI/SYSTEM/Windows Update. Fechar a interface continua possível, mas não devolve direitos do Windows. A proteção contra finalizar a interface e seu relançamento por supervisor são outra capacidade; o serviço de autorização não reinicia a UI.

## Build e verificação

```powershell
dotnet run --project desktop/CepHoras.Control.Tests -c Release
./scripts/build-corporate-msi.ps1 -Version 0.3.0
```

Testes usam executores falsos para ações de sistema; nunca instalam serviço, modificam política ou desligam Windows. Cobrem autorização/negação, limite de tentativas, confirmação, duplicidade, dono do cancelamento, divergência de política, falhas e rollback da transação, backup antes de mutação, protocolo limitado, token real em pipe descartável e recusa de servidor falso antes de transmitir senha.

`scripts/test-corporate-msi.ps1` lê o banco MSI sem instalar: verifica escopo, serviço, execução elevada de restauração, ordem antes de StopServices, rollback, exclusão de upgrades, ACL de arquivos e payload. O WiX executa ICE com avisos tratados como erro.

**Limite de validação:** serviço LocalSystem instalado, política efetiva após novo logon/GPO, desligamento real, botão físico, atualização, desinstalação e rollback elevados ainda exigem homologação da TI em VM/PC piloto. A entrega não é uma afirmação de homologação dessas operações. O [roteiro completo](../desktop/CepHoras.CorporateInstaller/LEIA-ME-TI.txt) acompanha o ZIP.

Referências: [direito de desligamento](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/shut-down-the-system), [políticas do menu](https://learn.microsoft.com/en-us/windows/configuration/start/policy-settings), [segurança de serviços](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights), [API de desligamento](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-initiatesystemshutdownexw).

## Resultado da preparação — 30/09/2026

Build Release e WiX/ICE concluídos sem erros/avisos. Testes de autorização/IPC/transação e leitura do MSI passaram. O teste confere `HidePowerOptions` contra a definição **Machine** do `StartMenu.admx` instalado; `NoClose` é uma política de usuário e não foi usada em HKLM. Leitura de direitos LSA reais não pôde ser validada sem elevação (acesso negado), permanecendo no roteiro da TI. Regressão WPF/WebView2 com fixture de API também passou (login, refresh, DPAPI, notificações e logout).

Entrega local: `C:\Users\LuizOtavio\Downloads\CEP-Horas-Corporativo-0.3.0-TI`. ZIP contém MSI, roteiro, checksum do MSI e ferramenta de recuperação self-contained. A cópia entregue foi conferida por hash. O serviço corporativo e seu diretório de configuração continuam ausentes nesta máquina; o aplicativo de teste 0.2.7 permaneceu aberto.

- MSI SHA-256: `350d336a98c8421f0f08ead4d72cb0ecb2fd9a1a43c5e07dc357ba86367c7c54`.
- ZIP SHA-256: `3cb806462fae3f75a81e23f07390342348143159dfcf9f7863969f4e3b72bc98`.
