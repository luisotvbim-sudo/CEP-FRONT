# Atualização do MSI corporativo

Implementação em 02/10/2026, sobre `codex/installer-current` `dc58bde`, no checkout isolado `codex/msi-auto-updater`. O objetivo é distribuir o CEP Horas para aproximadamente 40 computadores sem colocar credenciais administrativas ou do GitHub nos clientes. O [handoff anterior](contexto-atualizador-msi.md) permanece como registro do desenho e dos critérios de aceite.

## Canal e raiz de confiança

O canal MSI usa releases públicas de `luisotvbim-sudo/CEP-FRONT`, tag canônica `installer-vX.Y.Z`, com três assets de nomes fixos:

- `CEP-Horas-Windows-win-x64.msi`;
- `CEP-Horas-Windows-win-x64.manifest.json`;
- `CEP-Horas-Windows-win-x64.manifest.sig`.

O manifesto possui exatamente `product`, `version`, `asset`, `size` e `sha256`. O publicador escreve JSON compacto em UTF-8 sem BOM, com um LF final. A assinatura destacada é RSA-PSS com SHA-256 sobre esses bytes exatos; o `.sig` contém os bytes binários, não Base64. O hash é hexadecimal minúsculo e cobre o MSI completo. O limite do pacote é 512 MiB.

A chave pública RSA 3072 em `desktop/CepHoras.Updates/MsiUpdatePublicKey.pem` é um recurso embutido no assembly compartilhado pelo serviço e pelo WPF. A chave privada pertence somente à publicação. O serviço valida a assinatura, a origem fixa, tamanho, hash e a identidade interna do banco MSI: `ProductName=CEP Horas`, `Manufacturer=Conceito`, `UpgradeCode=8D0D0DC8-E744-42E7-A57A-20F489145ED8`, versão correspondente e plataforma x64. O publicador também confere `ALLUSERS=1`.

Esta é uma assinatura destacada de atualização. Ela não equivale a Authenticode no executável/MSI, nem elimina os avisos de confiança do Windows na instalação manual bootstrap. A verificação elevada depende da chave pública instalada no bootstrap, não somente de um hash informado pela própria release. Release draft/prerelease não entra no canal estável.

A descoberta lê manifesto e assinatura pelos caminhos fixos `releases/latest/download/<asset>`, sem consultar a API REST do GitHub. Assim a frota de 40 computadores na mesma saída de internet não consome a cota de 60 consultas REST anônimas por IP/hora. A versão só é interpretada depois de autenticar os bytes; o pacote é obtido na tag canônica `installer-v<versão assinada>`. Manifesto e assinatura de releases diferentes são rejeitados. Na publicação, marcar a release estável MSI como **latest**; releases de outros canais, como MSIX, devem usar `--latest=false`.

## Criar e preservar a identidade de publicação

Usar Windows e PowerShell 7. Criar a identidade uma vez, antes de compilar o bootstrap:

```powershell
./scripts/new-msi-update-key.ps1 `
  -PrivateKeyPath .local/update-signing/publisher.key
```

O script não substitui arquivos existentes. A privada PKCS#8 fica protegida por DPAPI `CurrentUser`; o arquivo permite acesso somente ao usuário atual, Administradores e SYSTEM. Apenas a pública SPKI PEM deve entrar no Git. O script não imprime nem grava privada em PEM plaintext. Builds e pastas de artefatos não devem receber o `.key`.

DPAPI vincula a chave ao usuário/perfil Windows que a protegeu. Copiar `publisher.key` sozinho não constitui recuperação portátil. Antes de usar o canal para a equipe, a TI precisa exportar e guardar um backup criptografado e provar que consegue recuperá-lo:

```powershell
./scripts/new-msi-update-key.ps1 `
  -PrivateKeyPath .local/update-signing/publisher.key `
  -ExportRecoveryBackup `
  -RecoveryBackupPath .local/update-signing/publisher.encrypted.pk8
```

A exportação pede senha e confirmação no terminal, sem argumentos ou impressão da senha. O backup DER PKCS#8 usa AES-256-CBC e PBKDF2-SHA256 com 600 mil iterações. Guardar o arquivo fora da máquina de publicação e a senha em um cofre separado. Nenhum dos dois pertence à release, ao MSI ou ao repositório.

Em outra máquina/perfil, preservar a pública aprovada e importar para um caminho novo, sem substituir outra privada:

```powershell
./scripts/new-msi-update-key.ps1 `
  -PrivateKeyPath .local/update-signing/publisher.key `
  -PublicKeyPath desktop/CepHoras.Updates/MsiUpdatePublicKey.pem `
  -ImportRecoveryBackup `
  -RecoveryBackupPath '<caminho local do backup criptografado>'
```

A importação pede a senha, confirma que a privada recuperada corresponde à pública já distribuída e protege novamente com DPAPI do usuário atual. A privada descriptografada existe apenas em memória e é limpa ao concluir. Não gerar outra identidade para cada versão: isso impediria que o bootstrap confiasse nas próximas atualizações. Rotação de confiança exige uma entrega específica de compatibilidade.

## Build e assinatura

`0.4.7` é o bootstrap manual; `0.4.8` é a primeira atualização automática do piloto. O build padrão é `0.4.7`. O pacote instalado 0.4.6 ainda exige uma primeira atualização manual administrativa.

```powershell
./scripts/build-corporate-msi.ps1 -Version 0.4.7 `
  -UpdateSigningKeyPath .local/update-signing/publisher.key

./scripts/build-corporate-msi.ps1 -Version 0.4.8 `
  -UpdateSigningKeyPath .local/update-signing/publisher.key
```

Os artefatos ficam em `.local/corporate-msi/<versão>/artifacts`. O build publica React/WPF e serviço, inspeciona a estrutura MSI, assina o manifesto e verifica a assinatura com a pública embutida. O ZIP da TI inclui pacote, manifesto, assinatura, checksum, instruções e recuperação. A pasta de saída não é substituída silenciosamente.

Sem `-UpdateSigningKeyPath`, o script permite um build local de inspeção e exibe aviso: o resultado não está pronto para o canal automático. Falta da pública embutida impede o build. A assinatura pode ser executada separadamente somente no pacote de nome fixo:

```powershell
./scripts/sign-msi-update.ps1 `
  -PackagePath .local/corporate-msi/0.4.7/artifacts/CEP-Horas-Windows-win-x64.msi `
  -Version 0.4.7 -SigningKeyPath .local/update-signing/publisher.key
```

O assinador usa `ProductVersion` lido do MSI, rejeita divergência com a versão pedida, confere identidade/plataforma e só gera artefatos quando a privada corresponde à pública. Manifesto/assinatura existentes não são sobrescritos. Não renomear ou editar os assets depois da assinatura; qualquer byte diferente no manifesto invalida a assinatura.

## Preparar a release pela TI

A autenticação `gh` existe somente no computador de publicação da TI. O aplicativo consulta releases públicas sem token. A release deve apontar para o commit revisado que produziu o pacote. Preparar inicialmente como draft, com notas em arquivo local:

```powershell
$version = '0.4.7'
$assets = ".local/corporate-msi/$version/artifacts"
gh release create "installer-v$version" `
  "$assets/CEP-Horas-Windows-win-x64.msi" `
  "$assets/CEP-Horas-Windows-win-x64.manifest.json" `
  "$assets/CEP-Horas-Windows-win-x64.manifest.sig" `
  --repo luisotvbim-sudo/CEP-FRONT --target '<SHA revisado completo>' `
  --draft --title "CEP Horas Windows $version" `
  --notes-file .local/release-notes-msi.txt
```

Depois da homologação, publicar uma versão MSI como latest: `gh release edit "installer-v$version" --repo luisotvbim-sudo/CEP-FRONT --draft=false --latest`. Essa ação altera o canal que todos os clientes consultam. Antes dela, o draft pode ser revisado e baixado pela TI autenticada; os clientes não o descobrem.

Inspecionar assets/tag/versão e as evidências do build antes de publicar. A publicação é uma ação explícita do responsável, separada do script de build. Não substituir bytes de uma versão publicada; uma correção recebe versão/tag nova. Releases draft não permitem comprovar a descoberta no canal estável. Para o piloto `0.4.8`, publicar no canal somente quando os únicos clientes bootstrap habilitados forem as máquinas piloto; assim a descoberta real pode ser testada antes das demais 40 instalações.

## Operação e aceite do piloto

WPF apresenta disponibilidade e solicita apenas uma operação fechada ao serviço. O serviço confirma novamente a release, baixa em armazenamento privado, valida e inicia a instalação. Não recebe URL, caminho, token ou argumentos arbitrários do usuário. O modo de manutenção de atualização é separado do fechamento diário: a atualização não restaura as políticas de energia. O fluxo histórico MSIX permanece separado do MSI.

Os arquivos e o journal ficam em `%ProgramData%\Conceito.CepHoras.Updates`, com acesso somente a SYSTEM e Administradores. A raiz específica evita alterar pastas compartilhadas de outros aplicativos. O serviço usa uma cópia privada do executor e do runtime para que a instalação possa substituir e reiniciar o próprio serviço. Falha de inicialização do atualizador mantém a proteção e supervisão existentes. O MSI não agenda restauração de política durante rollback de upgrade; políticas iniciais e sua reversão pertencem à primeira instalação.

O controle de energia do produto exige Windows 11 Pro, Enterprise ou Education 24H2 ou superior. Uma sessão adicional com CEP Horas ainda aberto impede a atualização até que feche; o executor retorna falha em 45 segundos e não encerra à força aplicativos de outra sessão. O piloto deve conferir essa condição e a retomada após reboot.

Antes do rollout, instalar `0.4.7` manualmente numa VM Windows/PC piloto e usar uma conta padrão para trocar para `0.4.8`. Verificar:

1. Aviso/bandeja, **Depois** e confirmação de **Atualizar agora**.
2. Instalação sem pedir credencial administrativa ao usuário comum.
3. MSI alterado, assinatura de outra identidade, versão/UpgradeCode divergentes e downgrade rejeitados.
4. Uma única instalação concorrente, falha MSI e reinício no meio da manutenção.
5. Serviço/aplicativo novos, uma única instância, sessão/notificações e retomada da supervisão.
6. Políticas de energia preservadas durante update e fechamento diário ainda funcionando de forma independente.
7. Recuperação da chave de publicação por backup, com a mesma pública.

Depois do piloto, ampliar para dois ou três computadores antes dos demais. Compilação, inspeção do banco MSI e testes de segurança em memória não comprovam `0.4.7 -> 0.4.8` real, políticas no Windows, recuperação em cliente ou entrega nas 40 máquinas. Registrar versão, fase, código de saída e evidências sanitizadas; não registrar sessão, senha/PIN ou chave privada.

## Estado das evidências

Os scripts de publicador estão implementados e separados da instalação/publicação. O histórico anterior de 16 verificações MSIX não representa o atualizador MSI. Build integrado, assinatura do artefato e testes do novo cliente/serviço devem ser registrados pela entrega correspondente. Instalação elevada no piloto, troca real `0.4.7 -> 0.4.8`, backup externo recuperado e rollout ainda exigem evidência humana/operacional; não foram executados por estes scripts.
