# Página de download do beta MSI 0.4.24

Esta branch, baseada em `main` `491059c`, altera somente a página pública `/download` para apontar ao asset versionado `installer-v0.4.24/CEP-Horas-Windows-win-x64.msi`. O card identifica a distribuição como beta manual e orienta instalação e atualização pela TI. O link do convite continua apontando à página genérica; a API não muda.

A página deve ser implantada **depois** que a prerelease manual 0.4.24 e seu asset forem publicados e verificados. A prerelease deve permanecer fora de `releases/latest`, usado pelo atualizador automático. Código na branch, release GitHub e imagem web implantada são estados separados.

O MSI 0.4.24 piloto foi construído antes desta edição; seu React embarcado ainda contém o card 0.4.22. Alterar o site web não muda os bytes do MSI já testado. Não reconstruir outro MSI com o mesmo número 0.4.24; registrar essa limitação no roteiro da TI para o beta manual.

Validar o link público em `plugincep.com.br` e `cep.lat`, além de `/healthz` e do proxy `/api/`, depois do deploy. O teste de navegador desta branch cobre URL, versão, requisitos, ausência de chamada de API e acessibilidade da página. Nenhuma publicação é comprovada por este commit.
