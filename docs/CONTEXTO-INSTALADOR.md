# Contexto atual do instalador e aplicativo corporativo

Reconciliado em 04/10/2026 por leitura dos commits abaixo. Este é o ponto de entrada para energia, serviço Windows, MSI, recuperação e atualização do CEP Horas. O instalador pertence ao CEP-FRONT; o repositório `01-CEP-INSTALADOR` contém um protótipo CEP Hub e não é a implementação deste pacote.

## Bases e disponibilidade

| Base analisada | Versão do build MSI | Capacidades presentes no código |
|---|---|---|
| `main` — `eb63dbdc7f7bf83d0a4b51ee5567ed5aa80c138c` | Padrão `0.4.3` | PIN pessoal da API, serviço/políticas de energia, instância única e recuperação do WebView2. Não contém o fechamento diário nem o atualizador MSI. |
| `codex/installer-integrado` — `dc58bde1617e6e1af6b61bea87c87fb5da9366a9` | Padrão `0.4.6` | Acrescenta fechamento local protegido, restauração de políticas e suspensão/retomada da supervisão. Não contém o atualizador MSI. |
| `codex/msi-auto-updater` — `95fbf5c4ff982916edacba5406d4b569d8007be8` | Padrão `0.4.7`; piloto proposto `0.4.7 → 0.4.8`; recuperação adicional `0.4.9` | Acrescenta atualização MSI assinada via serviço e, na evolução 0.4.9, carregamento/recarga nativos e detecção de conteúdo vazio. Entrega do [PR #9](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/9), fora da `main` analisada. |

Um número passado ao script de build não incorpora funcionalidades de outra branch. Para gerar 0.4.9 com essas mudanças, partir do código do atualizador, não renomear um pacote produzido pela main. A documentação pode estar disponível nas três bases; a matriz delimita o que cada uma realmente implementa.

O contrato de backend analisado é `CEP-API/main` `b36c6e149b42253b44860d98c6ffe44f98c53dd6`. Há relatos de implantação em 01/10, mas a revisão documental não confirmou SHA/imagem, migrations, PIN configurado ou versões instaladas atualmente. CI e leitura do banco MSI não comprovam instalação, políticas efetivas, ações de energia ou atualização real.

## Ordem de leitura

1. [Especificação do produto](produto/especificacao-funcional.md) e [contexto do Front](CONTEXTO-ATUAL.md): escopo funcional e limites com a API.
2. [Menu de energia](menu-energia.md): endpoints, liberação pessoal, decisão, contingência e bridge.
3. [Instalador corporativo](instalador-corporativo.md): políticas, componentes, instalação e recuperação.
4. [Atualizador MSI](atualizador-msi.md): guia específico da implementação na branch do atualizador, confiança, publicação e piloto.
5. [Orquestrador](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR): bases correntes, decisões e Issues que registram as entregas.

Os antigos contextos de energia/instalador e de atualizador foram substituídos por estes documentos. Histórico de prompts, propostas e resultados anteriores permanece no Git; não deve ser usado como estado atual.

## Responsabilidades e confiança

| Componente | Responsabilidade |
|---|---|
| CEP API | Autenticação e organização; análise pessoal; tolerância; PIN administrativo dedicado; prazo de cinco minutos; limites de tentativa; auditoria. |
| React | Apresentar a resposta e pedir operações permitidas. Não calcula autorização nem recebe tokens de sessão do host. |
| WPF/WebView2 | Guardar sessão com DPAPI `CurrentUser`, validar origem e allowlist, repetir a consulta autenticada e conversar pelo protocolo fixo. |
| Serviço `CepHorasControl` | Rodar como `LocalSystem`, aplicar/verificar políticas, supervisionar host instalado e agendar/cancelar ações fixas. Na branch do atualizador, confirmar release, validar pacote e coordenar manutenção. |
| MSI/publicador | Instalar por máquina com administrador; conservar a identidade do produto; produzir e assinar a distribuição. A privada de publicação permanece fora dos clientes. |

O named pipe verifica identidade interativa e caminho do processo `CepHoras.exe` instalado. Não aceita URL, arquivo ou linha de comando arbitrários. PIN, senha de login e token da API não são enviados ao serviço. Administradores/SYSTEM continuam sendo recuperação; o mecanismo não tenta resistir a quem administra a máquina.

## Decisões que devem ser preservadas

- A API decide Desligar/Reiniciar/Hibernar para a conta autenticada; o WPF revalida antes de agendar.
- Liberação por PIN é pessoal, de cinco minutos do servidor, e não dispensa a revalidação. O PIN e sua configuração não pertencem à documentação, ao MSI ou aos logs.
- Somente falha de transporte confirmada pelo host permite contingência. Qualquer resposta HTTP, inclusive 503, significa API alcançável.
- A ação usa dez segundos e cancelamento; navegador, Debug e pacote portátil não executam energia local.
- A senha diária de fechamento local existe apenas nas branches que a incluem. É independente do PIN da API. Suspender a supervisão tem efeitos distintos de liberar uma ação ou manter uma atualização.
- O atualizador requer confirmação **Atualizar agora/Depois**. Instalação sem clique é uma mudança funcional pendente de decisão.
- Atualização MSI mantém políticas de energia e usa manutenção própria. Não reutiliza o fechamento protegido que restaura políticas.
- Web, API, MSI e MSIX possuem ciclos próprios. O atualizador MSI consulta o GitHub público, sem token no cliente e sem novo endpoint na API.

## Plataforma e recuperação

O controle corporativo exige cliente Windows x64 com build ≥26100 e edição Professional, Enterprise ou Education: Windows 11 24H2 ou posterior dentro dessas famílias. Windows 10, Home e Server não são suportados pelo controle analisado. A frota de aproximadamente 40 máquinas precisa ser conferida antes do rollout; alterar esse requisito exige entrega própria.

Direitos de desligamento ficam restritos a Administradores/SYSTEM; opções nativas são ocultadas; botão curto de energia/sono e tampa recebem política de não fazer nada. Pressão prolongada, corte de energia, firmware, GPO de domínio e operações críticas do Windows ficam fora da garantia. A instalação precisa ser homologada com conta comum e meios de recuperação administrativos disponíveis.

Recuperação de interface não encerra o serviço nem executa energia. A recuperação completa disponível desde 0.4.3 preserva o perfil antigo e cria outro. A recarga da evolução 0.4.9 preserva perfil/sessão e só recria o navegador quando necessário. A detecção de falha não prova a causa original da tela branca.

## Fontes de código para continuar

As fontes comuns estão em [PowerBridgeHandler](../desktop/CepHoras.Desktop/PowerBridgeHandler.cs), [ApiSession](../desktop/CepHoras.Desktop/ApiSession.cs), [ApiRoutePolicy](../desktop/CepHoras.Desktop/ApiRoutePolicy.cs), [ControlService](../desktop/CepHoras.Control/ControlService.cs), [PowerAuthority](../desktop/CepHoras.Control/PowerAuthority.cs), [PolicyStore](../desktop/CepHoras.Control/PolicyStore.cs), [protocolo](../desktop/CepHoras.Control.Protocol/Protocol.cs), [Package.wxs](../desktop/CepHoras.CorporateInstaller/Package.wxs) e [build MSI](../scripts/build-corporate-msi.ps1).

Para fechamento protegido, consultar [DesktopLifecycleController na base integrada](https://github.com/luisotvbim-sudo/CEP-FRONT/blob/dc58bde1617e6e1af6b61bea87c87fb5da9366a9/desktop/CepHoras.Control/DesktopLifecycleController.cs). Para atualização/recarga, usar as referências fixadas no [guia do atualizador](atualizador-msi.md), pois esses arquivos não existem em todas as bases.

Antes de uma entrega, conferir `git status`, branch e SHA; ler o `AGENTS.md` local; escolher objetivo e aceite na fila. Não tratar a documentação de outra branch como prova de que o checkout já contém aquele comportamento.

## Pendências de aceite

| Fila | Evidência necessária |
|---|---|
| [#6 — atualizador](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/6) | Troca real 0.4.7 → 0.4.8 com conta comum, falha/rollback/reboot, diagnóstico de indisponibilidade, canal e recuperação externa da chave. |
| [#7 — energia](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/7) | Políticas efetivas, três ações/cancelamento, fechamento/retomada, troca de sessão e desinstalação/restauração. |
| [#11 — Windows](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/11) | Inventário da frota, decisão sobre Windows 10/Home e homologação nas edições suportadas. |
| [#12 — WebView2](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/12) | Recuperação 0.4.9 no pacote instalado e evidência do incidente original; não confundir tela branca com banner do atualizador. |

Esta limpeza e reescrita documental foi solicitada pelo usuário e é registrada na [Issue #13](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/13). Não publica release, não instala pacote, não executa política/ação de energia e não substitui as evidências operacionais acima.
