# Refatoração do atualizador MSI

Registro da implementação de 04/10/2026, vinculada à [Issue central #14](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/14). Base: `1911a317dda45e10cd2302af97e8bdfe9a385a61`, branch de trabalho `codex/installer-reliability`. O código do canal MSI vem do PR #9; esta entrega não declara merge, publicação ou instalação homologada.

## Escopo e achados

| Achado na base | Correção e evidência |
|---|---|
| `DownloadAsync` podia retornar pacote final depois de cancelamento ocorrido na inspeção MSI síncrona. | Verifica o token antes e depois da inspeção, remove o parcial cancelado e publica o nome final somente após essa verificação. O novo teste cancela dentro da inspeção: falha na fonte da base e passa na corrigida. Isso não comprova entrada indevida em manutenção: o coordenador já verificava cancelamento antes de `ready`. |
| A biblioteca verificava reparse point apenas na pasta final. Uma pasta normal abaixo de junction continuava aceita. | Valida todos os ancestrais na entrada, antes da publicação e na revalidação pré-instalação. Fixture Windows cria junction sem elevação e comprova recusa antes de HTTP/escrita. O teste falha com a fonte da base e passa na corrigida. O serviço já possui sua própria validação de ACL/ancestrais; a correção fecha a lacuna da biblioteca, sem substituir aquela fronteira. |
| O download usava apenas `FlushAsync`, enquanto o journal do serviço usava `Flush(true)`. | Solicita flush do arquivo ao disco antes de fechá-lo/validá-lo/publicá-lo. Falha nesse passo percorre a limpeza do parcial. Interrupção de energia real e comportamento do armazenamento exigem piloto; não foram simulados. |
| Verificação RSA e interpretação JSON usavam os buffers mutáveis recebidos do chamador. | Captura uma cópia privada de manifesto e assinatura antes de autenticar e interpretar. O resultado conserva esses mesmos bytes, sem outra cópia redundante. Teste comprova que o resultado continua autenticável depois de o chamador alterar os buffers fornecidos. É uma proteção de concorrência, sem alegar reprodução de exploração no serviço. |
| `RSA.ImportFromPem` aceita também chaves privadas; um recurso chamado público poderia embutir material privado por engano. | O build exige PEM contendo exclusivamente `PUBLIC KEY` SPKI e RSA 3072 antes de compilar. Fixture recusa marcador privado sintético e pública RSA 2048; a pública RSA 3072 passa essa etapa. A aceitação de privada pelo importador foi confirmada somente com chave efêmera em memória, sem exportá-la para disco. Nenhuma privada foi encontrada no repositório. |
| Requisitos de build eram descobertos depois de criar saída incompleta. | O script exige Windows/PowerShell 7, comandos `pnpm`/`dotnet` e SDK .NET 10 antes de criar a pasta da versão. Teste simula runtime sem SDK e comprova recusa sem artefatos. |

Permanece a autenticação dos bytes exatos do manifesto por RSA-PSS/SHA-256, os cinco campos conhecidos, os limites de tamanho, URL canônica derivada da versão, allowlist HTTPS de GitHub/CDNs, hash/tamanho e identidade MSI, x64/por máquina/UpgradeCode. Descoberta igual ou inferior à versão instalada não produz atualização. Não foi alterada a chave pública nem a identidade do produto.

O canal histórico MSIX mantém testes próprios e não comprova segurança ou homologação do canal MSI. Não se extraiu transporte comum entre os canais: suas fontes de confiança e identidade são diferentes.

## Validação executada

Ambiente: Windows `10.0.26200.0`, x64, PowerShell `7.6.5`, SDK .NET `10.0.401` local ao worktree. Não houve instalação de SDK global, MSI, serviço, política ou ação de energia neste escopo.

```powershell
dotnet run --project desktop/CepHoras.Updates.Tests -c Release
git diff --check -- desktop/CepHoras.Updates desktop/CepHoras.Updates.Tests scripts/build-corporate-msi.ps1
```

Suite aprovada: 16 verificações do canal MSIX e 80 do canal MSI, incluindo quatro casos de preflight de build. Os testes de transporte/identidade usam conteúdo identificado como fixture, HTTP injetado e chaves RSA efêmeras; a inspeção da identidade nativa de um MSI real não é substituída por eles. A análise sintática PowerShell de `build-corporate-msi.ps1` também passou.

Para provar regressão, foram copiadas apenas as pastas Updates/Updates.Tests para `.local/updater-baseline-regression`; a implementação `MsiGitHubUpdates.cs` foi substituída naquela cópia pela fonte do SHA base. A execução falhou no novo caso de cancelamento; removendo somente esse caso da cópia, falhou no caso de ancestral junction. Os fontes da branch de trabalho não foram revertidos durante essa verificação.

## Dependências de aceite

Journal, lease/retenção de tentativas, executor SYSTEM e diretório efetivo de instalação são responsabilidades do serviço e tratados no relatório da frente Control. Preflight Windows/edição/WebView2, sequência de remoção/rollback e inspeção estrutural do pacote pertencem à frente MSI. Esta validação do build verifica o ambiente de produção dos artefatos, não a compatibilidade do computador que vai receber o MSI.

A distribuição continua aguardando ambiente piloto autorizado: MSI real assinado com a identidade aprovada, descoberta de duas versões pelo canal estável, instalação/upgrade/repair, interrupção/rollback, respostas 3010/1603/1618, reinstalação/restauração e evidência de serviço/supervisão/sessão após manutenção. Não se instalou MSI elevado, não se usou chave de publicação, não se publicou release e não se validaram ações de energia nesta estação.
