# Candidato MSI 0.4.14 — Windows 10 22H2 x64

Preparado em 06/10/2026 na branch `codex/windows10-compat`, a partir do beta
0.4.13 (`b42ba3900f8d555b638aedbc7683279ce6fca3a2`). O usuário definiu
Windows 10 **22H2 x64 Pro, Enterprise e Education** como escopo. A [Issue #11](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/11)
acompanha o aceite da frota.

## Matriz do pacote

| Sistema cliente x64 | Build | Resultado do preflight |
|---|---:|---|
| Windows 10 22H2 Pro/Enterprise/Education | 19045 | Aceito para piloto |
| Windows 11 24H2+ Pro/Enterprise/Education | 26100+ | Mantido |
| Windows 10 anterior, Windows 11 anterior, Home, Server ou x86 | Outros | Rejeitado |

O preflight do MSI, o serviço e `Verificar-Windows.ps1` seguem a mesma matriz.
WebView2 Evergreen instalado por máquina continua obrigatório. O `Installed OR`
do MSI permanece para permitir manutenção/remoção de uma instalação existente
mesmo se o ambiente perder um pré-requisito. O UpgradeCode, escopo por máquina,
autostart, serviço LocalSystem, políticas, journal, rollback, assinatura de
manifesto de atualização, sessão DPAPI e interface do 0.4.13 permanecem no
mesmo pacote. Os caminhos de energia e autorização da API não foram alterados.

O pacote é `self-contained` para `win-x64`. A documentação Microsoft confirma
WebView2 e as políticas de energia utilizadas em Windows 10, mas a [matriz
oficial do .NET 10](https://learn.microsoft.com/en-us/dotnet/core/install/windows)
não lista Windows 10 22H2. Distribuir o runtime dentro do MSI elimina a
dependência de uma instalação .NET separada; não estende o suporte oficial do
fabricante. Tratar o 22H2 como compatibilidade funcional condicionada ao piloto.
Fontes: [WebView2](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-supported-operating-systems),
[menu de energia](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-startmenu#hidepoweroptions),
[botões e tampa](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-power).

## Verificações e limite

- Suite pura do serviço passou nesta branch, incluindo a matriz de builds e
  edições; testes do atualizador (80 verificações) e Desktop (312 checks) passaram.
  Esses testes não alteram políticas nem executam energia real.
- O build React + WPF + serviço `win-x64` self-contained + WiX passou com zero
  avisos/erros. A inspeção do MSI confirmou preflight, serviço LocalSystem,
  custom actions, ACL, rollback e payload. O driver WPF/WebView2 real passou
  no Windows 11 Pro build 26200 com fixture descartável.
- A assinatura RSA-PSS/SHA-256 do manifesto foi verificada com a pública
  embutida nas bibliotecas do aplicativo e do serviço. O MSI permanece sem
  Authenticode, como o beta anterior. MSI 0.4.13 e 0.4.14 têm a mesma contagem
  de arquivos (895), componentes (929), serviço, ações, registros e atalhos.
- Instalação, atualização, rollback e desinstalação elevados em Windows 10
  seguem pendentes do piloto do usuário em outro computador.

| Artefato local `.local/corporate-msi/0.4.14/artifacts/` | Bytes | SHA-256 |
|---|---:|---|
| `CEP-Horas-Windows-win-x64.msi` | 99319634 | `c868b46be1c1513ff8e21553a91a64e05a0778adffa608e4f59e9e1b22591c1a` |
| `CEP-Horas-Windows-0.4.14-TI.zip` | 163623194 | `f021b9883d8dce2795a13316d24ef8773f5409eca5057118bc36f1d5561e6481` |

O beta público 0.4.13 e a página `/download` continuam a indicar Windows 11.
O atualizador consulta somente a release estável `releases/latest`; este
candidato não deve ser confundido com uma versão selecionada por esse canal.

## Piloto Windows 10 antes de distribuir

Em Windows 10 22H2 x64 de cada edição escolhida, registrar build, edição,
WebView2 e versão instalada, sem credenciais nem dados pessoais. Conferir:

1. Instalação elevada, uso em conta comum, inicialização por sessão, login,
   refresh/DPAPI, jornada, histórico e notificações.
2. Políticas efetivas em Iniciar, Ctrl+Alt+Del, tela de login, Alt+F4, botão
   curto de energia/sono e tampa em AC/bateria; GPO/MDM, se houver.
3. Decisões `allowed`, `blocked` e `indeterminate` da API; três ações de
   energia, dez segundos e cancelamento; contingência apenas de transporte.
4. Fechamento protegido pela bandeja, restauração e reaplicação de políticas,
   inclusive com sessões simultâneas.
5. Upgrade de 0.4.13 para 0.4.14 em Windows 11 e posterior upgrade de 0.4.14
   em Windows 10; manutenção, falha/rollback, reinício e desinstalação com
   restauração do snapshot original. O 0.4.13 não instala limpo em Windows 10.

O piloto em Windows 10 ainda não foi executado. CI, inspeção da tabela MSI e
testes com executores falsos não comprovam os efeitos elevados nessa versão.
