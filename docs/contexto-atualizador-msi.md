# Contexto para continuidade — atualizador do MSI corporativo

> Aditivo de implementação em 02/10/2026: o checkout isolado `codex/msi-auto-updater`, baseado em `dc58bde`, implementa o canal MSI e os scripts de publicação. A raiz de confiança escolhida é assinatura destacada RSA-PSS/SHA-256 do manifesto com pública RSA 3072 embutida. Build padrão bootstrap `0.4.7`; primeiro upgrade real de homologação `0.4.8`. O publicador usa privada DPAPI CurrentUser e exportação/importação de backup PKCS#8 com senha; nenhuma credencial pertence aos clientes. Procedimento e limites em [Atualizador MSI](atualizador-msi.md). A instalação piloto, backup externo recuperado e rollout para aproximadamente 40 máquinas permanecem pendentes de evidência operacional. O texto abaixo preserva o estado e desenho anteriores à implementação; seus números de testes e descrição MSIX são históricos.

Registrado em 02/10/2026 na branch `codex/installer-integrado`. Este documento descreve o estado real, o funcionamento pretendido e a sequência segura para outro agente implementar o atualizador do CEP Horas sem reconstruir o contexto da aplicação.

## Objetivo

Atualizar o CEP Horas instalado pelo MSI corporativo em aproximadamente 30 computadores Windows, normalmente usados por contas sem privilégio administrativo.

O fluxo desejado é:

1. o aplicativo verifica se existe versão mais nova ao iniciar e a cada seis horas;
2. apresenta um aviso discreto com **Atualizar agora** e **Depois**;
3. quando o usuário confirma, o serviço local baixa e valida o MSI;
4. o CEP Horas entra em manutenção sem liberar as opções nativas de energia;
5. o Windows Installer atualiza aplicativo e serviço;
6. o serviço e o aplicativo voltam a executar na versão nova;
7. em qualquer falha, a versão anterior continua utilizável e a tentativa pode ser repetida.

A atualização do programa é independente da CEP API, do deploy web e do PostgreSQL. Não criar endpoint na API para esta função.

## Estado atual verificável

- A versão corporativa atual é `0.4.6` e é gerada por `scripts/build-corporate-msi.ps1`.
- O pacote é `CEP-Horas-Windows-win-x64.msi`, self-contained e instalado por máquina em `C:\Program Files\Conceito CEP Horas`.
- O MSI usa o `UpgradeCode` fixo `8D0D0DC8-E744-42E7-A57A-20F489145ED8` e já contém `MajorUpgrade`.
- O serviço `CepHorasControl` roda como `LocalSystem`, aplica as políticas de energia e supervisiona o aplicativo WPF da sessão ativa.
- O usuário comum não pode parar ou reconfigurar o serviço.
- O WPF já possui banner, botão e temporizador de atualização em `desktop/CepHoras.Desktop/MainWindow.xaml.cs`.
- `desktop/CepHoras.Updates/GitHubDesktopUpdates.cs` já consulta as releases públicas de `luisotvbim-sudo/CEP-FRONT`, escolhe versão maior, limita o tamanho, valida SHA-256, baixa por HTTPS e remove arquivos inválidos.
- As 16 verificações em `desktop/CepHoras.Updates.Tests` cobrem somente o fluxo histórico de MSIX.

O atualizador existente **não atualiza o MSI corporativo**. Ele aceita apenas tags `desktop-vX.Y.Z.W`, procura o asset `CEP-Horas-win-x64.msix`, exige `AppxManifest.xml` e abre o Instalador de Aplicativos. A instalação MSI 0.4.6 não possui essa identidade. Não apresentar as 16 verificações atuais como teste do novo fluxo MSI.

## Decisão de distribuição

Usar uma release pública do mesmo repositório, sem token do GitHub dentro do aplicativo.

Convenção proposta para o MSI:

- tag: `installer-v0.4.7`;
- pacote: `CEP-Horas-Windows-win-x64.msi`;
- manifesto: `CEP-Horas-Windows-win-x64.manifest.json`;
- assinatura do manifesto ou pacote: publicada junto da release quando o mecanismo escolhido exigir arquivo separado.

O MSI usa versão de três partes. O atualizador deve rejeitar tag, arquivo, versão ou origem que não correspondam exatamente à convenção aprovada. Releases draft e prerelease não entram no canal estável.

O manifesto deve ser pequeno, versionado e conter no mínimo:

```json
{
  "product": "Conceito.CepHoras",
  "version": "0.4.7",
  "asset": "CEP-Horas-Windows-win-x64.msi",
  "size": 12345678,
  "sha256": "HEX_COM_64_CARACTERES"
}
```

Não incluir token, senha, certificado privado, URL arbitrária, argumentos do Windows Installer ou comandos no manifesto.

## Modelo de confiança obrigatório

O instalador será executado como `LocalSystem`. Hash obtido da mesma conta que hospeda o binário detecta corrupção, mas sozinho não protege uma máquina se a conta/release for comprometida. Antes de habilitar a instalação silenciosa, escolher e implementar uma raiz de confiança independente.

Caminho recomendado para este ambiente:

1. criar um certificado de assinatura de código controlado pela Conceito;
2. manter a chave privada somente na máquina/CI que publica releases, nunca no repositório ou no MSI;
3. instalar apenas o certificado público confiável na versão bootstrap;
4. assinar cada MSI futuro;
5. no serviço, validar a assinatura pelo Windows e fixar a identidade ou impressão digital permitida;
6. validar também SHA-256, tamanho, versão MSI, fabricante, nome do produto e `UpgradeCode`.

Uma assinatura destacada do manifesto com chave pública embutida no serviço é alternativa possível, desde que a chave privada permaneça fora dos computadores clientes. Não implementar instalação elevada confiando somente na URL ou no digest informado pela própria release.

## Divisão de responsabilidades

### WPF, na conta do usuário

- verifica disponibilidade e mostra o aviso;
- apresenta versão disponível e as ações **Atualizar agora** e **Depois**;
- não baixa em pasta escolhida pelo usuário para posterior execução elevada;
- não executa `msiexec` como administrador;
- não recebe chave privada nem permissão genérica do serviço;
- ao confirmar, pede ao serviço somente a instalação da atualização já descoberta no canal fixo.

Se o CEP Horas estiver somente na bandeja, uma versão disponível pode gerar um aviso nativo único. Não repetir a notificação a cada consulta.

### Serviço `CepHorasControl`, como `LocalSystem`

- consulta ou confirma a mesma release em host/repositório fixos;
- baixa para uma pasta privada em `%ProgramData%\Conceito\CepHoras\Updates`, com ACL apenas para `SYSTEM` e Administradores;
- valida origem, versão, tamanho, SHA-256, assinatura e identidade MSI;
- impede downgrade, reinstalação da mesma versão e instalação concorrente;
- cria estado de manutenção recuperável antes de iniciar o Windows Installer;
- inicia a atualização sem aceitar caminho, URL ou argumentos fornecidos pelo usuário;
- registra somente versão, fase, código de saída e diagnóstico sem segredo;
- após reiniciar, reconcilia o estado da tentativa e relança o WPF quando adequado.

O named pipe nunca deve aceitar comandos como “execute este arquivo”, URL livre ou linha de comando. O pedido do WPF pode significar apenas `check-update`, `install-approved-update` e `get-update-status`, com o serviço recalculando todas as decisões privilegiadas.

## Manutenção e políticas de energia

Não reutilizar `desktop-suspend`: esse comando representa o fechamento autorizado pelo usuário e restaura as opções nativas de energia. Atualização é outro estado.

Criar um modo de manutenção específico com estas propriedades:

- suspende temporariamente apenas o relançamento do processo antigo;
- preserva as políticas de bloqueio já aplicadas;
- cancela qualquer contagem regressiva de energia pendente;
- permite encerrar o WPF e seus WebView2 vinculados;
- expira ou é reconciliado automaticamente se a instalação não começar;
- não permanece ativo depois de falha, reinício ou conclusão.

O `Package.wxs` já evita restaurar as políticas em um `MajorUpgrade` por meio de `NOT UPGRADINGPRODUCTCODE`. Preservar essa condição. A nova versão do serviço deve revalidar o estado das políticas ao iniciar.

## Execução da atualização

Fluxo sugerido:

1. WPF encontra uma versão maior e mostra o banner.
2. Usuário confirma **Atualizar agora**.
3. Serviço busca metadados novamente e adquire um bloqueio global de atualização.
4. Serviço baixa em arquivo temporário privado, valida tudo e renomeia atomicamente para o nome final.
5. Serviço grava um marcador de manutenção contendo versão anterior, versão alvo e fase.
6. WPF recebe o estado `ready`, fecha de modo próprio e não restaura políticas.
7. Serviço inicia `msiexec.exe /i <pacote-validado> /qn /norestart /l*v <log>` em processo destacado.
8. O Windows Installer para e substitui o serviço conforme a tabela do MSI e executa rollback nativo se necessário.
9. O serviço novo, ao iniciar, compara a versão instalada com o marcador, encerra a manutenção e relança o WPF.
10. Em falha, a instalação anterior permanece ou é restaurada pelo MSI; o serviço remove a manutenção, relança o aplicativo e conserva log para a TI.

Não aguardar o `msiexec` dentro de uma operação que dependa de o próprio serviço continuar vivo durante `StopServices`. O processo de instalação precisa sobreviver à parada do serviço. Testar explicitamente esse ponto na máquina piloto.

## Bootstrap e rollout

A versão 0.4.6 não contém um atualizador MSI utilizável. Portanto:

- `0.4.7` deve ser a versão bootstrap, instalada manualmente uma única vez com autorização administrativa;
- ela inclui validação de assinatura, protocolo restrito, modo de manutenção e lógica MSI;
- `0.4.8` deve ser a primeira atualização automática de homologação;
- somente depois da troca real `0.4.7 -> 0.4.8` em máquina piloto o canal deve ser usado nos demais computadores.

Não publicar `0.4.7` como automaticamente atualizável até a raiz de confiança estar definida. Uma máquina em `0.4.6` deve ignorar o canal MSI novo ou continuar no comportamento atual, nunca tentar tratar o MSI como MSIX.

Rollout indicado:

1. VM Windows limpa;
2. computador piloto com conta comum;
3. dois ou três computadores internos;
4. restante da equipe.

## Comportamento de falhas

- Sem internet/GitHub indisponível: não bloquear o CEP Horas; tentar novamente no próximo ciclo.
- CEP API indisponível: não interfere no atualizador; são canais diferentes.
- Release malformada, hash divergente ou assinatura inválida: rejeitar e registrar diagnóstico local.
- Versão menor/igual: ignorar.
- Download interrompido: excluir parcial ou mantê-lo somente com extensão temporária inacessível ao usuário.
- MSI falha: preservar/recuperar versão anterior, sair do modo de manutenção e reabrir o aplicativo.
- Reinício inesperado: o serviço reconcilia o marcador com a versão realmente instalada.
- Atualização já em andamento: devolver o estado existente; não iniciar outro `msiexec`.

A disponibilidade de atualização nunca pode liberar desligamento, alterar a senha diária, estender o PIN administrativo nem modificar as decisões da CEP API.

## Arquivos que o próximo agente deve revisar

- `desktop/CepHoras.Updates/GitHubDesktopUpdates.cs`
- `desktop/CepHoras.Updates.Tests/Program.cs`
- `desktop/CepHoras.Desktop/MainWindow.xaml.cs`
- `desktop/CepHoras.Desktop/MainWindow.xaml`
- `desktop/CepHoras.Control/ControlService.cs`
- `desktop/CepHoras.Control/DesktopLifecycleController.cs`
- `desktop/CepHoras.Control.Protocol/`
- `desktop/CepHoras.CorporateInstaller/Package.wxs`
- `scripts/build-corporate-msi.ps1`
- `scripts/test-corporate-msi.ps1`
- `docs/instalador-corporativo.md`
- `docs/contexto-controle-energia-instalador.md`

Antes de editar, seguir `AGENTS.md` e preservar as garantias existentes de energia, sessão, API, WebView2 e recuperação.

## Sequência de implementação recomendada

1. Separar os modelos e parsers de MSIX e MSI; não quebrar silenciosamente o fluxo histórico.
2. Criar parser estrito da release/manifesto MSI e testes de origem, versão, tamanho e digest.
3. Definir a raiz de confiança e implementar verificação de assinatura com testes negativos.
4. Adicionar leitura segura das propriedades do banco MSI e conferir produto, fabricante, versão e `UpgradeCode`.
5. Estender o protocolo com mensagens de atualização fechadas e limites de tamanho.
6. Implementar armazenamento privado, bloqueio global e máquina de estados no serviço.
7. Implementar modo de manutenção separado do fechamento protegido.
8. Adaptar banner, bandeja e estados do WPF.
9. Integrar assinatura e geração do manifesto ao build/release.
10. Ampliar testes, gerar `0.4.7`, instalar manualmente e homologar a atualização para `0.4.8`.

## Critérios mínimos de aceite

- conta padrão consegue iniciar uma atualização aprovada sem conhecer senha administrativa;
- nenhum URL, caminho ou argumento arbitrário atravessa a fronteira para `LocalSystem`;
- MSI alterado, não assinado, assinado por outra identidade, de outro produto ou com versão divergente é rejeitado;
- downgrade e duas instalações simultâneas são rejeitados;
- atualização mantém as políticas de energia ativas;
- fechamento diário continua restaurando políticas e permanece independente da manutenção;
- falha e reinício no meio da atualização recuperam o aplicativo;
- versão, serviço e arquivos instalados correspondem ao pacote novo;
- serviço volta a supervisionar a sessão e o WPF abre uma única instância;
- logs não contêm senha diária, PIN, token de sessão ou credencial de assinatura;
- `0.4.7 -> 0.4.8` passa em VM e computador piloto antes do rollout.

## Comandos de verificação existentes

```powershell
dotnet run --project desktop/CepHoras.Updates.Tests -c Release
dotnet run --project desktop/CepHoras.Control.Tests -c Release
dotnet run --project desktop/CepHoras.Desktop.Tests -c Release
dotnet build desktop/CepHoras.Desktop -c Release
dotnet build desktop/CepHoras.Control -c Release
./scripts/build-corporate-msi.ps1 -Version 0.4.7
```

Esses comandos são a base, mas os testes existentes ainda não comprovam o update MSI. O teste final exige duas versões assinadas e instalação real em Windows.

## Fora do escopo desta documentação

Este registro não implementa o atualizador, não cria certificado, não publica release, não instala MSI e não altera a CEP API. Ele consolida a decisão e o caminho de continuidade para uma implementação posterior na branch do instalador.
