# Beta MSI 0.4.13 — distribuição pelo GitHub

Preparação em 06/10/2026, branch `codex/beta-msi-convite`. Integra a interface
web `main` `18aa262947d25f505d79501aa79aaa3f6680aa7b` com a auditoria Windows
`32983a50414560a891f0adfa90d05c4d89e0faae` (PR #19), que incorpora a liberação
v3 do PR #16. O merge local é `ee8ae12`. Releases 0.4.11/0.4.12 são imutáveis.
Não confundir pacote gerado, draft, publicação, main, produção e versão instalada.
Demanda transversal: [CEP-ORQUESTRADOR #23](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/23).

## Pacote e convite

O pacote por máquina conserva a identidade e a pública do atualizador anterior:
MSI x64, `ALLUSERS=1`, UpgradeCode `8D0D0DC8-E744-42E7-A57A-20F489145ED8`.
Inclui aplicativo self-contained, serviço e recuperação TI. Exige Windows 11
x64 Pro/Enterprise/Education 24H2+ e WebView2 Evergreen por máquina. A instalação
inicial e os upgrades manuais exigem administrador.

O download minimalista `/download` aponta ao
[MSI 0.4.13](https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/installer-v0.4.13/CEP-Horas-Windows-win-x64.msi).
Esse link só atende convidados anônimos depois de publicar o draft como
prerelease. Publicação do pacote deve preceder implantação da página e do
e-mail de convite. A API é responsável pelo e-mail: ativação e download são
ações distintas, e o endereço de download não contém código de convite.

A interface incluída acompanha a web atual: senha de 6 a 200 caracteres,
sino de notificações pessoais, simplificação do histórico e reprocessamento
normal de 17 dias. A API compatível já foi registrada em produção pelo
orquestrador; esta preparação não implanta nem homologa a API.

## Canal beta

GitHub foi escolhido pelo usuário; não há hospedagem de MSI na Oracle VM.
Release `installer-v0.4.13`: prerelease, `latest=false`. O atualizador existente
consulta somente `releases/latest`; não descobre prereleases beta. O piloto
usa instalação/upgrade manual pela TI. Manifesto RSA-PSS assinado permite
verificar a origem/integridade, sem ativar canal beta automático. Assinatura
destacada é diferente de Authenticode: este pacote ainda não possui certificado
de editor Windows. Não alterar políticas UAC/antivírus para distribuí-lo.

## Aceite do piloto Windows

Começar em 3–5 máquinas acompanhadas pela TI, com trabalhos salvos e recuperação
administrativa disponível. Ampliação para 40 usuários depende desses resultados.
Os testes automatizados, WPF descartável e inspeção do MSI não fecham o piloto.

| Ensaio | Resultado a registrar sem dados pessoais |
|---|---|
| Compatibilidade | Edição/build/x64/WebView2 por máquina; preflight somente leitura. |
| Instalação e upgrade 0.4.12 → 0.4.13 | Hash/versões/retorno MSI, serviço automático, inicialização no logon, ACLs e identidade. |
| Conta | Ativação pelo convite, login/refresh/logout e retomada; senha mínima atual; permissões da API. |
| Interface e avisos | Minha jornada, histórico, sino/central, pendentes multipágina/restart, popup e recuperação WebView2. |
| Saída protegida | Fechar na bandeja após verificação diária restaura registros; abrir reaplica; sessão antiga pode exigir novo logon uma vez. |
| Energia | API allowed/blocked/indeterminate/HTTP versus transporte, ações reais e cancelamento em máquina descartável; reserva de hibernação. |
| Falhas/remoção | Rollback controlado, manutenção/reboot/3010, uninstall/restauração, reinstalação e recuperação TI. |
| Sessões/GPO | Outra sessão impede restauração global; políticas de domínio e tokens originais preservados. |

Aceites completos e simulação de atualização pelo serviço estão detalhados na
[auditoria](AUDITORIA-INSTALADOR-2026-10-06.md). Perfil v3 permite comandos
externos de desligamento conforme decisão humana anterior. Não reverter a v2.

## Build e evidência

`scripts/build-corporate-msi.ps1 -Version 0.4.13 -UpdateSigningKeyPath <arquivo DPAPI local>`
gera MSI, kit TI, manifesto, assinatura e SHA256SUMS em diretório novo ignorado.
A privada permanece local, protegida, sem exportação/rotação. A mesma pública
é validada contra ambos assemblies publicados antes da assinatura.

Fonte do payload: `aa5d05d46aa1fbc5fbfd1a742a9b20738d3f6d79`. Desktop e serviço
publicados declaram `0.4.13+aa5d05d46aa1fbc5fbfd1a742a9b20738d3f6d79`.
MSI: 99.315.505 bytes, SHA-256
`a61e38ecb0b154f097f382bbcd929280b7599e1b730ac7e05a11a01c9a599742`.
Kit TI: 163.622.451 bytes, SHA-256
`370cdc4695c6b9af84e13872608048ba7136a771a99964512e0524cba83fff92`.

Passaram lint, 100 unidades web, 220 testes browser desktop/mobile, 312 checks
nativos de sessão/storage, suites Control (confiabilidade/recuperação/migração/
hibernação), Updates (16 + 80 MSI + 4 preflight), build web, Desktop Debug,
publish self-contained Desktop/Control Release, MSI e inspeção estrutural.
Driver WPF/API descartável passou, incluindo loading/recuperação, bandeja,
popup, notificações multipágina, refresh, DPAPI/restart, bridge e logout.
O driver de falha de configuração inválida também passou.

O MSI foi extraído sem instalar: 895 arquivos conferidos contra publish,
dez assets web contra build atual e 402 arquivos de recuperação contra kit TI,
sem divergências. RSA-PSS válido, mesma pública embutida nos dois assemblies e
mesma identidade da 0.4.12. A extração WiX emitiu avisos de representação de
tabelas de serviço/ACL; a inspeção do banco MSI verificou os registros originais.
MSI permanece `Authenticode=NotSigned`.

Os resultados e hashes estão na [evidência sanitizada](evidencias/beta-msi-0.4.13.json).
Logs de sessão/MSI/configurações privadas
não integram Git ou release. Nenhuma instalação, alteração de política,
ação real de energia, logoff, reboot, deploy ou promoção latest ocorre neste
trabalho de preparação.
