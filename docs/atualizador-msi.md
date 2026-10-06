# Atualizador MSI: implementação e publicação

Referência atual conferida em 06/10/2026: MSI 0.4.12, base `b467c0a2571fdb8324f99d181934e21f6d785cfa`, [PR #16](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/16), ainda draft. O atualizador originado no PR #9 está incorporado nessa base. A tabela abaixo conserva o histórico de 04/10; consulte [contexto corrente](CONTEXTO-INSTALADOR.md) e [auditoria](AUDITORIA-INSTALADOR-2026-10-06.md) para correções e limites de validação.

O objetivo é atualizar o MSI corporativo em aproximadamente 40 computadores com contas comuns, após um bootstrap instalado por administrador. WPF apresenta **Atualizar agora/Depois**; serviço confirma e instala a versão aprovada sem pedir credenciais administrativas ao funcionário. Instalação sem clique permanece uma mudança funcional não aprovada. API, deploy web, PostgreSQL e MSIX são ciclos separados; não há endpoint da CEP API nem token GitHub no cliente para essa função.

## Bases e evidência

| Base/versão | Situação do código |
|---|---|
| Main 0.4.3 | Sem atualizador MSI. |
| Integrado 0.4.6 | Sem atualizador MSI; primeira migração para o bootstrap requer instalação administrativa. |
| Atualizador 0.4.7 | Bootstrap com raiz de confiança, protocolo e executor privilegiado. É o padrão do script nessa base. |
| Atualizador 0.4.8 | Primeira versão seguinte proposta para homologar atualização 0.4.7 → 0.4.8. |
| Atualizador 0.4.9 | Acrescenta carregamento/recarga WebView2 e detecção de conteúdo vazio; construir a partir dessa branch. |

A inspeção do código confirma implementação. CI, assinatura de artefato e inspeção MSI não comprovam instalação/upgrade, recuperação externa da chave ou distribuição. As [Issues #6](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/6), [#7](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/7), [#11](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/11) e [#12](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/12) concentram o aceite pendente. Release estável, versões instaladas e operação atual não foram confirmadas por esta revisão.

## Canal e autenticidade

O canal fixo é o GitHub público `luisotvbim-sudo/CEP-FRONT`, tag canônica `installer-vX.Y.Z`. A release possui três assets com nomes exatos:

- `CEP-Horas-Windows-win-x64.msi`;
- `CEP-Horas-Windows-win-x64.manifest.json`;
- `CEP-Horas-Windows-win-x64.manifest.sig`.

O manifesto contém exatamente `product`, `version`, `asset`, `size` e `sha256`; duplicatas/campos adicionais são rejeitados. `product` é `Conceito.CepHoras`, `asset` é o nome fixo do MSI e `version` tem três partes canônicas, dentro dos limites MSI. O pacote deve ter até 512 MiB; manifesto até 64 KiB e assinatura até 1024 bytes.

A pública RSA 3072 de `desktop/CepHoras.Updates/MsiUpdatePublicKey.pem` é embutida no assembly compartilhado. A privada existe somente na publicação. A assinatura destacada RSA-PSS/SHA-256 cobre os bytes originais do manifesto **antes** de interpretar o JSON. O publicador produz UTF-8 sem BOM, JSON compacto e LF final; `.sig` é binário, não Base64. O SHA-256 cobre todo o MSI. Reformatar o manifesto ou alterar um asset depois de assinado invalida a release.

Além de assinatura/hash/tamanho, conferir identidade interna MSI: `ProductName=CEP Horas`, `Manufacturer=Conceito`, `UpgradeCode=8D0D0DC8-E744-42E7-A57A-20F489145ED8`, versão correspondente, x64 e `ALLUSERS=1`. Serviço e executor refazem as validações; a origem/hash sozinhos não autorizam execução como SYSTEM.

A assinatura destacada autentica o canal; não é Authenticode do executável/MSI e não elimina os avisos de confiança do Windows no bootstrap. Não substituir essa raiz de confiança por um hash hospedado ao lado do arquivo ou por credencial administrativa no cliente.

## Descoberta e origem

A descoberta usa `releases/latest/download/<manifesto ou assinatura>`, sem API REST do GitHub. Isso evita consumir a cota REST anônima compartilhada pelas máquinas atrás da mesma saída. Versão assinada determina a URL canônica `releases/download/installer-v<versão>/<MSI>`; pacote de outra tag/caminho é rejeitado.

Só HTTPS em porta padrão, sem credencial/fragmento, para `github.com`, `release-assets.githubusercontent.com` e `objects.githubusercontent.com`; no máximo cinco redirecionamentos, todos conferidos. Download temporário é removido em falha e só passa ao nome final após tamanho, hash e identidade válidos. Manifesto/assinatura de releases diferentes falham na autenticação.

O serviço consulta novamente ao confirmar uma instalação e exige que a versão continue sendo a aprovada e maior que a instalada. Uma versão igual/menor não é instalada. WPF consulta ao abrir, a cada seis horas e pela bandeja; falha de GitHub/rede não bloqueia o uso normal do CEP Horas.

**Regra de publicação:** somente release MSI estável homologada deve ser marcada `latest`. Draft/prerelease não são o canal distribuído. Releases de outros canais devem usar `--latest=false`. O cliente usa os assets de `latest`, não uma leitura de flags draft/prerelease por REST; manter essa convenção é responsabilidade do publicador. Um draft baixado pela TI não comprova descoberta pelo cliente anônimo.

## Chave de publicação e recuperação

Os scripts exigem Windows e PowerShell 7. Gerar uma identidade apenas no computador de publicação da TI, antes do bootstrap:

```powershell
./scripts/new-msi-update-key.ps1 `
  -PrivateKeyPath .local/update-signing/publisher.key
```

O script não substitui arquivos existentes. A privada PKCS#8 fica protegida por DPAPI `CurrentUser`; ACL permite usuário atual, Administradores e SYSTEM. A privada não é escrita em PEM plaintext, impressa, copiada para build/release ou versionada. Somente a pública SPKI PEM entra no código.

DPAPI vincula o arquivo ao usuário/perfil que o protegeu. Copiar `publisher.key` sozinho não é recuperação portátil. Antes do rollout, criar backup criptografado e provar recuperação mantendo a mesma pública:

```powershell
./scripts/new-msi-update-key.ps1 `
  -PrivateKeyPath .local/update-signing/publisher.key `
  -ExportRecoveryBackup `
  -RecoveryBackupPath .local/update-signing/publisher.encrypted.pk8
```

A exportação pede senha/confirmação interativas, sem argumento ou impressão. O DER PKCS#8 usa AES-256-CBC e PBKDF2-SHA256 com 600 mil iterações. Guardar o backup fora da máquina de publicação e a senha em cofre separado. Nenhum dos dois pertence ao Git, MSI, ZIP da TI publicado ou release.

Em outro perfil/máquina, usar a pública aprovada e caminho novo para a privada:

```powershell
./scripts/new-msi-update-key.ps1 `
  -PrivateKeyPath .local/update-signing/publisher.key `
  -PublicKeyPath desktop/CepHoras.Updates/MsiUpdatePublicKey.pem `
  -ImportRecoveryBackup `
  -RecoveryBackupPath '<backup criptografado em armazenamento local seguro>'
```

Importação pede senha, confere que a privada corresponde à pública distribuída e reprotege por DPAPI do usuário atual. O plaintext existe em memória e é limpo ao concluir. Não gerar identidade nova a cada versão: bootstrap deixaria de confiar nas atualizações. Rotação de confiança exige estratégia de compatibilidade própria.

## Build e assinatura

Executar somente no checkout da implementação, registrando SHA revisado e versão. Bootstrap 0.4.7 requer instalação manual administrativa; 0.4.8 serve ao primeiro piloto:

```powershell
./scripts/build-corporate-msi.ps1 -Version 0.4.7 `
  -UpdateSigningKeyPath .local/update-signing/publisher.key

./scripts/build-corporate-msi.ps1 -Version 0.4.8 `
  -UpdateSigningKeyPath .local/update-signing/publisher.key
```

O build publica React/WPF/serviço, inspeciona o banco MSI e gera/verifica manifesto assinado. Artefatos ficam em `.local/corporate-msi/<versão>/artifacts`; saída existente não é substituída silenciosamente. ZIP da TI inclui pacote, manifesto, assinatura, checksum, instruções e recuperação do aplicativo, sem privada/backup de assinatura.

Intermediários WiX são separados por versão e o MSI é copiado fisicamente; links físicos/simbólicos ficam desativados. Após construir a segunda versão, conferir novamente hashes/assinaturas de ambas: construir outra release não pode modificar bytes de uma anterior.

Sem `-UpdateSigningKeyPath`, o build permite inspeção local com aviso; o resultado não está pronto para o canal automático. Falta da pública embutida impede o build. Para assinar separadamente o pacote de nome fixo:

```powershell
./scripts/sign-msi-update.ps1 `
  -PackagePath .local/corporate-msi/0.4.7/artifacts/CEP-Horas-Windows-win-x64.msi `
  -Version 0.4.7 -SigningKeyPath .local/update-signing/publisher.key
```

O assinador confere ProductVersion/identidade/x64/escopo e correspondência privada/pública antes de produzir os assets; não sobrescreve manifesto/assinatura existentes. Não editar/renomear os assets assinados nem reutilizar a mesma versão para bytes novos.

## Preparar e publicar release

Autenticação `gh` pertence somente ao computador da TI. A release aponta ao commit revisado que gerou o pacote. Preparar como draft e manter notas sanitizadas em arquivo:

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

Depois da revisão/homologação, o responsável pode publicar essa release como latest:

```powershell
gh release edit "installer-v$version" `
  --repo luisotvbim-sudo/CEP-FRONT --draft=false --latest
```

Essa publicação muda o canal consultado por todos os bootstraps habilitados. Para testar a descoberta real de 0.4.8, manter somente máquinas piloto com bootstrap até concluir o aceite. A publicação é ação separada do build; estes exemplos não a executam. Correção de uma versão publicada exige versão/tag nova.

## Serviço, manutenção e executor

WPF envia somente `update-check`, `update-start`, `update-status` e `update-ready` pelo protocolo fechado, com a versão aprovada quando exigida. O serviço autentica o processo instalado, SID/sessão/PID e instante de criação; o aceite `ready` deve pertencer à instância que iniciou aquela tentativa. Não aceita URL, caminho, credencial ou argumento MSI arbitrário.

O estado/pacote/journal ficam em `%ProgramData%\Conceito.CepHoras.Updates`, apenas SYSTEM/Administradores, com recusa de links/reparse points e bloqueio exclusivo entre processos. Estados são `downloading`, `ready`, `installing`, `success` e `failed`. O serviço confirma release, baixa/valida, copia executor/runtime para diretório privado e grava manutenção antes de cancelar energia pendente.

`ready`/`installing` suspendem somente relançamento durante manutenção, bloqueiam novas ações de energia e preservam políticas. O fechamento diário `desktop-suspend` é outro mecanismo e não pode ser reutilizado para atualização. Falha de inicialização do atualizador conserva o controle/supervisão já existentes; estado de manutenção ilegível é tratado conservadoramente.

Após WPF confirmar prontidão e encerrar sua árvore WebView2, o executor SYSTEM privado espera até 45 segundos por qualquer host instalado ainda em execução. Uma outra sessão aberta impede a troca; não encerra à força aplicativos de outras sessões. O executor confere journal/identidade, mantém arquivo validado protegido e inicia apenas o `msiexec.exe` do Windows com argumentos fixos.

O executor e seu runtime sobrevivem à parada/substituição do serviço por `StopServices`/`MajorUpgrade`; a instalação não depende do processo antigo continuar vivo. Timeout MSI de 30 minutos é registrado, mas o executor mantém manutenção/bloqueio enquanto o instalador estiver ativo, em vez de matar a transação e declarar recuperação prematura.

Sucesso requer retorno 0 ou 3010 **e** versão instalada correspondente. 3010 mantém aviso de reinício e é reconciliado após novo boot. Reinício/expiração com tentativa interrompida gera falha, sem concluir só porque um arquivo já mostra a versão nova antes de `InstallFinalize`. Ao terminar, o executor tenta iniciar somente o serviço fixo instalado; o serviço reconcilia estado e retoma supervisão. A recuperação efetiva e rollback do Windows Installer precisam de teste real.

## Piloto obrigatório

Instalar bootstrap com administrador em VM Windows compatível, depois em PC piloto com conta comum. Usar duas versões produzidas com a mesma pública, registrar SHA/build/hash e resultados sanitizados. Verificar:

1. Descoberta real no canal estável; aviso/bandeja; **Depois** e **Atualizar agora**.
2. Atualização sem pedir credenciais administrativas ao funcionário; sessão independente da API.
3. Recusa de pacote alterado, assinatura de outra identidade, manifesto/tag/versão/UpgradeCode/escopo divergentes e downgrade.
4. Concorrência, clique/resposta de status simultâneos e sessão Windows adicional aberta.
5. Manutenção sem restaurar políticas, cancelamento de energia pendente e fechamento diário independente.
6. Executor sobrevivendo à troca do próprio serviço; falha MSI/rollback e reboot durante manutenção.
7. Nova versão efetiva, serviço/supervisão ativos, instância única, sessão/notificações e recuperação WebView2.
8. Código 3010/reinício; tentativa interrompida; nova tentativa sem manutenção permanente.
9. Recuperação do backup de publicação em outro perfil/máquina, mantendo pública aprovada e assinatura válida.

O banner **O atualizador precisa de revisão da TI** corresponde a indisponibilidade de inicialização local e exige diagnóstico próprio. Não afirmar correção por a descoberta deixar de usar REST ou por haver recarga do WebView2. Preservar somente versão, fase, código de saída e diagnóstico técnico; não copiar sessão, senha diária, PIN, chave, perfil ou dados pessoais.

Depois de VM/PC piloto, ampliar para duas ou três máquinas antes das demais. A frota precisa cumprir build ≥26100/edições corporativas conforme [instalador](instalador-corporativo.md). Esta reconciliação não executou instalação, publicação, teste de chave ou rollout.

## Código e verificações por entrega

Referências fixadas na base implementada, disponíveis mesmo ao ler este guia pela main:

- [MsiRelease](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Updates/MsiRelease.cs), [MsiGitHubUpdates](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Updates/MsiGitHubUpdates.cs) e [identidade MSI](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Updates/MsiPackageIdentity.cs).
- [MsiUpdateCoordinator](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Control/MsiUpdateCoordinator.cs), [UpdateStore](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Control/UpdateStore.cs), [UpdateState](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Control/UpdateState.cs) e [executor SYSTEM](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Control/MsiUpdateRunner.cs).
- [WPF de atualização](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Desktop/MainWindow.MsiUpdates.cs) e [recarga/carregamento](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/desktop/CepHoras.Desktop/MainWindow.WebView.cs).
- [Chave/recuperação](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/scripts/new-msi-update-key.ps1), [assinador](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/scripts/sign-msi-update.ps1) e [build](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/95fbf5c4ff982916edacba5406d4b569d8007be8/scripts/build-corporate-msi.ps1).

Ao alterar esse fluxo, executar suítes `CepHoras.Updates.Tests`, `CepHoras.Control.Tests`, `CepHoras.Desktop.Tests`, builds Release e inspeção estrutural MSI apropriados. Testes históricos de MSIX não são cobertura do MSI; registrar separadamente o que foi executado. O aceite operacional acima é independente dessas verificações.
