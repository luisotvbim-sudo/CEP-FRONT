# Preparação da página de download para o piloto MSI 0.4.18

Em 07/10/2026, `https://plugincep.com.br/download` e `https://cep.lat/download` respondiam HTTP 200 com bundle que apontava ao MSI 0.4.16. A [prerelease MSI 0.4.18](https://github.com/luisotvbim-sudo/CEP-FRONT/releases/tag/installer-v0.4.18) está disponível manualmente no GitHub, mas a publicação do pacote não altera a página web.

Este PR draft, criado da `main` web, prepara o botão público para o MSI versionado 0.4.18. O card identifica a versão como piloto manual, orienta acompanhamento da TI, informa que o MSI não possui Authenticode e pode gerar aviso de confiança no Windows, e esclarece que não há atualização automática. A assinatura RSA-PSS do manifesto protege o canal de atualização, mas não assina o MSI para o Windows. Requisitos informados: Windows 10 22H2 ou Windows 11 24H2+, x64 Pro/Enterprise/Education, com WebView2 por máquina.

O e-mail de convite da API usa `Email__DesktopDownloadUrl`, cujo padrão é `https://plugincep.com.br/download`; ele não fixa versão nem inclui o MSI. Portanto, uma eventual troca pública da página mudará o destino de novos cliques nesse e-mail sem alterar o backend. O e-mail de recuperação não oferece download do instalador.

A [Issue central #39](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/39) coordena a decisão de distribuição. Este PR não integra nem implanta o site. A homologação de instalação/upgrade e ações de energia em Windows real permanece na [Issue #34](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/34). A release continua prerelease, fora de `releases/latest`; o MSI não tem Authenticode. Antes de publicar a página, conferir CI do SHA exato, link/hash da release, texto e responsividade nos dois domínios, saúde web e rollback.
