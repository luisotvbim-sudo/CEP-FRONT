# Piloto Windows — MSI 0.4.18

Esta versão sucede o [piloto 0.4.17](piloto-windows-0.4.17.md), preservando as
correções dos PRs #28–#30 e o código funcional do PR #31. A nova versão segue a
regra do [atualizador MSI](atualizador-msi.md): não corrigir os arquivos de uma
versão já publicada sob a mesma tag.

O build usa a chave privada de publicação protegida por DPAPI no computador da
TI. A assinatura RSA-PSS/SHA-256 do manifesto deve conferir com a chave pública
já embutida no desktop e no serviço; o manifesto fixa o hash, tamanho e versão
do MSI. Nenhuma chave privada, backup ou senha integra os artefatos. O MSI não
possui assinatura Authenticode, que exige um certificado de assinatura de código
separado. Assinar o manifesto não remove o aviso de confiança do Windows.

Este é um piloto manual em prerelease, com `latest=false`. A assinatura do
manifesto não promove a versão ao canal automático. Instalação, upgrade,
políticas e ações reais de energia devem ser homologados pela TI em computador
Windows 10/11 compatível, com trabalho salvo e permissões administrativas.
Build, inspeção estrutural, testes, revisão independente e CI comprovam somente
o artefato e os caminhos exercitados por essas verificações.

Demanda: [CEP-ORQUESTRADOR #37](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/37).
