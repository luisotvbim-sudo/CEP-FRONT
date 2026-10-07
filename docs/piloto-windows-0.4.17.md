# Piloto Windows — MSI 0.4.17

Demanda e aceite: [CEP-ORQUESTRADOR #37](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/37).
Base de implementação: `a7e7426e70155237f6a8fe6125b047f88a86647d`,
PRs [28](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/28),
[29](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/29) e
[30](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/30).

O pacote reúne feedback sanitizado de senha diária/PIN, prazos separados para
IPC, retomada única após saída protegida incerta e descoberta de pedidos de
energia do titular com cancelamento explícito. A bandeja permite revisar esses
pedidos sem login na API. Retomar suspensão exige o mesmo SID Windows.
A refatoração preserva esses contratos; detalhes em
[feedback de senha/PIN](feedback-senhas-windows.md) e [menu Energia](menu-energia.md).

A publicação é prerelease, sem `latest`, para download manual pelo piloto.
Por decisão humana na Issue #37, o MSI e o kit podem ser disponibilizados
sem manifesto/assinatura de atualização, cuja assinatura pela identidade
existente permanece pendente. Esses dois arquivos não acompanham a release.
O MSI não possui assinatura Authenticode; esta entrega exige instalação manual.
Não altera `/download`, canal automático, web/API ou produção e não integra os
PRs à main. Chave pública, identidade MSI, política Windows e formato do
manifesto assinado permanecem os estabelecidos em
[atualizador MSI](atualizador-msi.md). A assinatura RSA-PSS do manifesto e a
assinatura Authenticode do MSI são verificações distintas.

A TI deve salvar o trabalho, executar `Verificar-Windows.ps1` e homologar
instalação/upgrade em Windows 10 22H2 x64 ou Windows 11 24H2+ x64 suportados,
com WebView2 por máquina. O kit contém o MSI, verificador, instruções e ferramenta
de recuperação. Validar saída diária, mensagens de PIN, retomada após falha,
pedido recuperado e isolamento entre contas Windows em ambiente piloto.
O PIN de seis dígitos mantém validade de cinco minutos e só autoriza ações CEP.

Build, inspeção estrutural, integridade, CI e revisão independente serão
registrados na entrega do pacote. Não comprovam instalação elevada, upgrade
real, ações reais de energia ou integração autenticada atual com a API.
