# Aplicativo Windows — contexto atual do host

Referência Windows conferida em 06/10/2026: [contexto do instalador](CONTEXTO-INSTALADOR.md) e [auditoria 0.4.12](AUDITORIA-INSTALADOR-2026-10-06.md). As matrizes datadas de 04/10 abaixo são históricas; a auditoria separa código, draft, checks e homologação pendente.


Revisão de 04/10/2026, com base `main` Front `eb63dbd` e API `b36c6e1`. WPF/WebView2 compartilha telas React com web e assume sessão, bridge, bandeja, popup e integração com serviço local. Instalação e publicação têm ciclos próprios; [instalador](instalador-corporativo.md) e [menu de energia](menu-energia.md) definem políticas/contratos.

## Bases e capacidades

| Base de código | Capacidades verificadas |
|---|---|
| `main` `eb63dbd`, MSI 0.4.3 | Instância única por sessão, bandeja, notificações/DPAPI, energia e reinício com backup/recriação de perfil WebView2 |
| `codex/installer-integrado` `dc58bde`, MSI 0.4.6 | Evoluções de instalação/serviço posteriores, fora da main auditada |
| [PR #9](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/9), `95fbf5c`, MSI 0.4.7–0.4.9 | Atualizador MSI, saída local protegida e recuperação ampliada de conteúdo/processos; integração e homologação completas pendentes |

A recuperação da main reage à inicialização/navegação falha, encerra somente host e subprocessos WebView2 pertencentes, mantém perfil anterior como backup e abre perfil novo. O serviço permanece ativo. A branch PR #9 acrescenta carregamento até conteúdo visível, timeout/root vazio/falha de processo e recarga antes de recriação; não presumir esse comportamento no código main. A implementação não comprova a causa do travamento original.

## Sessão e comportamento

- Tokens ficam em `ApiSession`, com refresh protegido por DPAPI `CurrentUser`, separado por API; React recebe somente metadados e resultados permitidos. Rotas/métodos são validados por `ApiRoutePolicy` no host, e o servidor continua autorizando cada requisição.
- Assets locais usam origem virtual HTTPS. Navegação para outras origens/permissões é bloqueada; links de atividade HTTPS acionados pelo usuário abrem externamente. Release desativa DevTools/menus de contexto.
- Fechar janela mantém bandeja. No MSI, saída/manutenção do usuário comum seguem a política da versão e o serviço supervisiona o host. Administradores e instalações não gerenciadas mantêm saída apropriada. “Sair da conta” revoga sessão; não se confunde com encerrar programa ou com PIN de energia.
- Bandeja oferece abrir, central e teste de popup identificado. Popup é `NotifyIcon.ShowBalloonTip`; resumo real abre a central. Recebimento não comprova leitura. Políticas Windows podem suprimir o popup.
- [Recepção](notificacoes-implementacao.md) recupera todas as páginas antes de confirmação, registra IDs DPAPI por conta/API, agrupa resumos e mantém a central como referência. Sem cache offline de mensagens/análises nem cálculo de horas local.
- Instalação por perfil usa registro `HKCU` de inicialização; MSI inicia em logon e usa serviço. MSIX declara tarefa no manifesto. Debug/portátil não registram inicialização automaticamente.
- Energia online vem da API; WPF revalida e serviço aceita somente desligar/reiniciar/hibernar, dez segundos e cancelamento. Qualquer HTTP, inclusive erro, impede considerar a API offline. Builds não gerenciados não executam ações de energia.

## Desenvolvimento e canais

```powershell
pnpm install --frozen-lockfile
pnpm build
dotnet run --project desktop/CepHoras.Desktop -c Debug
dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained false -o .local/package/CEP-Horas-win-x64
```

O publish framework-dependent exige .NET Desktop Runtime 10 x64 e Microsoft Edge WebView2 Runtime. Manter toda pasta publicada, incluindo `wwwroot`; Release usa `https://api.cep.lat`, Debug local. `CEP_API_URL` substitui origem e aceita HTTP só loopback. `--test-notification` é demonstração local, `--background` inicia oculto. Ferramentas de teste nativo extras existem somente em Debug com `CEP_DESKTOP_TESTING=1`.

| Canal | Limites e continuidade |
|---|---|
| Portátil/ZIP de teste | Pasta completa, sem controle corporativo de energia e sem atualização automática |
| `scripts/install-desktop.ps1` | Instalação por perfil, confere arquivos, cria atalho e recusa substituir instalação existente; não migra automaticamente para MSI |
| MSIX preservado na main | Atualizador somente em Release com marker/manifesto MSIX; consulta `desktop-vX.Y.Z.W` ao abrir/a cada seis horas, verifica hash/identidade e abre Instalador de Aplicativos após clique. Requer pacote assinado confiável; `UNSIGNED` serve só inspeção |
| MSI corporativo | Pacote por máquina, self-contained, serviço, políticas e recuperação TI; seguir documentação da branch/versão e homologar elevados |
| Atualizador MSI PR #9 | Canal distinto do MSIX, manifesto assinado e execução pelo serviço; não existe na main auditada nem foi comprovado em release estável |

A página pública `/download` aponta à prerelease histórica `desktop-v0.2.0.1-test`, assets `CEP-Horas-Windows.zip`/`SHA256SUMS.txt`. Tag de teste não é release assinada `desktop-vX.Y.Z.W` e não ativa canal MSI. A auditoria não encontrou release MSI estável, nem upgrade completo/piloto de frota comprovado.

Antes de distribuir, build em diretório novo e hashes do pacote, identidade/versionamento coerentes e assinatura/canal conforme aceite. Nunca empacotar perfis, sessões, credenciais, PINs ou material privado. Atualizar site/download e release é publicação distinta de instalar na estação ou implantar na VM.

## Evidência e verificações

Esta reescrita inspecionou código/contratos, sem instalar, publicar, executar ações de energia ou repetir testes históricos. Testes existentes de sessão/rotas/DPAPI e driver WPF/API descartável podem ser reproduzidos conforme [README](../README.md); fixtures não comprovam fontes reais, produção, assinatura ou upgrade.

Homologar por versão/Windows: login/retomada/revogação, perfis e escopos, pendentes multipágina/reinício/rede, popup/Não perturbe, início/supervisão por sessão, recuperação preservando perfil, políticas/ações/cancelamento e desinstalação/recuperação. Upgrade MSI exige máquina piloto, transição real entre versões e plano de recuperação. Compatibilidade Windows 10/Home e estado da frota permanecem decisões/evidências pendentes na [fila central](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues).
