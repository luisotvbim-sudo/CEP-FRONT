# Contexto atual do instalador e aplicativo corporativo

Na branch `codex/power-pin-bridge-error`, o candidato MSI 0.4.15 conserva a
matriz 0.4.14 e corrige o [envelope de erro do bridge](pin-admin-bridge-0.4.15.md).
Na branch anterior `codex/windows10-compat`, o candidato MSI 0.4.14 amplia o preflight
para Windows 10 22H2 x64 Pro/Enterprise/Education e preserva Windows 11 24H2+.
Ver [compatibilidade 0.4.14](windows10-msi-0.4.14.md) para escopo, verificações
e homologação pendente. A release beta 0.4.13 publicada mantém seu próprio
requisito e artefatos imutáveis.

Preparação em 06/10/2026: [beta MSI 0.4.13](beta-msi-0.4.13.md), branch
`codex/beta-msi-convite`, consolida a web main `18aa262` e a auditoria `32983a5`.
Beta é atualização manual pela TI, prerelease no GitHub com `latest=false`.
As referências 0.4.12 abaixo conservam o pacote anterior. Candidato gerado
não comprova piloto instalado ou distribuição homologada à frota.

Base corrente conferida em 06/10/2026: PR #16 e draft `installer-v0.4.12`, ambos
em `b467c0a2571fdb8324f99d181934e21f6d785cfa`. A auditoria e as correções em
`codex/installer-deep-cleanup` estão em
[AUDITORIA-INSTALADOR-2026-10-06](AUDITORIA-INSTALADOR-2026-10-06.md).
Draft, código, versão instalada, CI e homologação Windows são evidências distintas.
A main web `18aa262` não é a origem desse MSI.

O instalador pertence ao CEP-FRONT. `01-CEP-INSTALADOR` é um protótipo CEP Hub
separado. A fila e o contexto transversal ficam no
[CEP-ORQUESTRADOR](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues).

## Leitura para continuar

1. [Contexto do Front](CONTEXTO-ATUAL.md), [especificação](produto/especificacao-funcional.md)
   e [compatibilidade](compatibilidade-backend.md): produto, API e limites.
2. [Auditoria corrente](AUDITORIA-INSTALADOR-2026-10-06.md): origem/payload,
   achados, correções, verificações e ensaios pendentes.
3. [Windows](aplicativo-windows.md), [energia](menu-energia.md),
   [MSI corporativo](instalador-corporativo.md) e [atualizador](atualizador-msi.md):
   contratos e procedimentos, observando o perfil de política e a base.
4. [Entrega 0.4.11](instalador-0.4.11.md): recuperação durável de energia;
   conserva a evidência anterior, sem representar o perfil de direitos v3 da 0.4.12.

## Bases de compatibilidade

| Base | Comportamento |
|---|---|
| Main histórica `eb63dbd`, 0.4.3 | Controle corporativo, sem fechamento diário ou atualização MSI. |
| Integrado `dc58bde`, 0.4.6 | Fechamento protegido e restauração/retomada de políticas. |
| PR #9, `95fbf5c`, 0.4.7–0.4.9 | Atualizador MSI assinado e evolução da recuperação WebView2. |
| 0.4.11 | Integra acompanhamento pessoal e recuperação durável de intenção de energia. |
| PR #16, `b467c0a`, 0.4.12 | Perfil v3 preserva direitos LSA originais; checkpoint de migração/rollback e mensagem sobre renovação de tokens antigos. |
| `codex/installer-deep-cleanup` | Correções da auditoria 06/10: redirects da API, durabilidade DPAPI/refresh, hibernação/cancelamento e manutenção desconhecida; separação WPF e fixtures compatíveis. |

MSIX e instalação por perfil continuam canais distintos. Seus códigos e
comandos administrativos/migrações não são removidos por não aparecerem na UI
MSI. Um parâmetro Version não incorpora código de outra branch.

## Responsabilidades e segurança

API autentica/autoriza, calcula horas e decide energia para a conta atual.
React apresenta os resultados. WPF guarda tokens com DPAPI CurrentUser,
valida origem/documento/allowlist e reconsulta a decisão. Serviço SYSTEM executa
somente ações/protocolo fixos, supervisiona o aplicativo e coordena atualização.
MSI instala por máquina; publicador mantém a privada fora dos clientes.

- Qualquer HTTP da API impede tratar transporte como offline, inclusive redirects.
  O cliente nativo corrigido observa a primeira resposta sem segui-la.
- Access/refresh não chegam ao renderer ou ao serviço. Refresh incerto exige login;
  a invalidação persistida precede a rotação. Organização continua imposta pela API.
- Energia usa dez segundos. Pedido herdado/incerto não é repetido ou cancelado por
  startup/recuperação/manutenção: exige cancelamento explícito com titular/origem.
- Cancelamento de hibernação só é confirmado antes da reserva do efeito nativo.
  Depois dessa fronteira, o estado não é convertido em sucesso de cancelamento.
- Fechamento local protegido restaura snapshot e suspende supervisão da sessão;
  recusa restauração global com outra sessão ativa e revalida antes de concluir.
  A verificação diária não é o PIN da API nem uma credencial de alta segurança.
- Manutenção MSI conserva políticas, bloqueia energia e relançamento e usa seu
  próprio journal. Estado de manutenção desconhecido permanece bloqueado para TI.
- Atualização exige clique humano, manifesto RSA-PSS, hash/tamanho/identidade MSI,
  ACLs privadas, owner de processo e executor independente da troca de arquivos.
  Draft não é canal latest; assinatura destacada não é Authenticode.

## Política v3 e limites Windows

0.4.12 preserva as atribuições originais de SeShutdownPrivilege e
SeRemoteShutdownPrivilege. Mantém restrições de interface, desligamento sem
login e botões físicos curtos/tampa. WPF veta encerramento não autorizado da
conta comum. Não descrever v3 como remoção de direitos LSA para usuários comuns:
essa era a política v2. Tokens criados pela versão antiga podem exigir novo
logon para refletir direitos restaurados; broadcast do shell não recria tokens.

Comandos externos de desligamento são possíveis conforme a escolha humana
registrada em [liberação 0.4.12](liberacao-energia-0.4.12.md), Issue #19.
Garantia contra encerramento forçado, GPO, administrador,
reinício crítico, firmware, corte de energia e botão prolongado não foi
certificada. Aceite do desenho v3 exige piloto específico; não retornar à política
anterior por inferência. As restrições de registro têm escopo de máquina.

Controle suportado: Windows cliente x64, build 26100+, famílias Professional,
Enterprise/Education e WebView2 por máquina. `check-corporate-windows.ps1` apenas
lê configuração. Não inventariar dados pessoais nem instalar nesta estação.

## Entrega e pendências

Correções e integridade do pacote constam da auditoria versionada, que separa
checks com fixtures de homologação elevada. Revalidar checkout, branch, SHA,
AGENTS e estado local antes de editar. Build não prova versão instalada.

- [#6](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/6): upgrade real,
  rollback/reboot/3010, canal e recuperação externa da chave.
- [#7](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/7): política v3,
  tokens/sessões, ações/cancelamento e uninstall/restauração em VM.
- [#11](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/11): compatibilidade
  real da frota nas edições/builds suportados.
- [#12](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/12): recuperação
  instalada, sem confundir falha React/WebView2 com indisponibilidade de update.

Nenhum merge, release estável/latest, instalação elevada, ação real de energia
ou implantação web/API integra esta auditoria.
