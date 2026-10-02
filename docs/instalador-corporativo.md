# Instalador corporativo integrado

Implementação de 30/09/2026 na branch `codex/installer-integrado`, construída sobre o menu autenticado e o contrato da CEP API `cf15a5c`.

## Componentes

O MSI 0.4.6 inclui a interface de liberação por PIN conforme a CEP API `main` `b36c6e1`, abertura de instância única, recuperação forçada do WebView2 e fechamento local protegido na bandeja com restauração temporária das políticas do Windows. Uma tentativa incorreta de fechamento apenas limpa e refoca o campo, sem mensagem visível. O host permite somente o POST exato de liberação e continua revalidando cada ação no servidor. O PIN da API nunca atravessa o named pipe nem pertence ao serviço ou ao pacote. Detalhes de expiração, rollout e testes em [menu de energia](menu-energia.md).

- Um único MSI por máquina instala React/WPF, o serviço `CepHorasControl`, inicialização em cada logon e a recuperação da TI.
- O serviço roda como `LocalSystem`. Usuário comum não recebe permissão para parar ou configurar o serviço.
- O WPF fecha a janela para a bandeja. O menu do ícone perto do relógio oferece **Fechar CEP Horas**, protegido pela senha diária local `ddMMyy#pec`; o serviço restaura a política original e suspende o relançamento somente depois da validação e apenas na sessão atual.
- Abrir novamente o atalho sinaliza a instância existente e traz a janela para a frente. Em falha de carregamento, **Reiniciar CEP Horas** encerra somente processos do CEP Horas/WebView2 da sessão, preserva o perfil anterior como backup e abre um perfil limpo; o serviço de proteção permanece ativo.
- O host revalida a ação na API; não confia no objeto devolvido pelo JavaScript. Somente `allowed` agenda. `blocked`, `indeterminate`, respostas inválidas e erros HTTP bloqueiam.
- Se a API não responder no transporte, o host confirma por uma consulta independente e permite a contingência. Qualquer resposta HTTP significa que a API está alcançável.
- Desligar, Reiniciar e Hibernar usam atraso fixo de dez segundos. Cancelar é idempotente e pertence à mesma identidade Windows que solicitou.

## Políticas

O instalador salva o estado anterior antes da primeira alteração e então:

- restringe `SeShutdownPrivilege` e `SeRemoteShutdownPrivilege` a `SYSTEM` e Administradores;
- ativa `HidePowerOptions` no escopo da máquina;
- desativa desligamento na tela sem login;
- define toque curto do botão de energia, botão de sono e fechamento da tampa como **Não fazer nada** em AC e bateria;
- preserva administradores/SYSTEM como recuperação.

O WPF cancela encerramento de sessão não autorizado do usuário comum. Pressão física prolongada, corte de energia, firmware, administrador/SYSTEM, atualização crítica do Windows e GPO de domínio permanecem fora da garantia.

## Build e testes

```powershell
dotnet run --project desktop/CepHoras.Control.Tests -c Release
./scripts/build-corporate-msi.ps1 -Version 0.4.6
```

Os testes do serviço usam um executor falso e não alteram política nem energia. O teste MSI lê o banco do pacote sem instalar e verifica escopo, serviço, custom actions elevadas, rollback, restauração antes da remoção, ACL e payload.

O aditivo 0.4.3 passou 200 verificações do desktop, incluindo exclusão de segunda instância, ativação da janela já iniciada, pedido de recuperação, backup do perfil WebView2 e idempotência. O upgrade local terminou com código MSI 0; após eliminar a instância antiga mantida em memória pelo Restart Manager, o serviço iniciou somente a versão nova e abrir o atalho manteve um único processo responsivo.

No aditivo 0.4.4, a senha de fechamento usa exatamente dia, mês e ano com dois dígitos e o sufixo minúsculo `#pec`. Ela é validada no WPF pelo relógio local, não aparece na interface ou nos logs e não depende da CEP API. O serviço aceita suspensão/retomada somente do `CepHoras.exe` instalado e associa a suspensão à identidade e à sessão Windows do processo. Reiniciar o serviço, abrir o aplicativo manualmente ou trocar de sessão restabelece a supervisão. Esse mecanismo é operacional, não uma credencial de alta segurança: um administrador capaz de mudar o relógio, o binário ou o serviço permanece um caminho de recuperação.

Correção 0.4.5: antes de confirmar o fechamento, o serviço restaura o snapshot original dos direitos e políticas e transmite a atualização de política ao shell. Se a restauração falhar, o aplicativo permanece aberto. Ao abrir novamente, o serviço aplica e verifica as restrições antes de retirar a suspensão. Logoff e início do serviço também reaplicam a proteção. Alterações de direitos de usuário do Windows são materializadas integralmente em novos tokens de logon; a atualização visual das opções nativas é solicitada imediatamente.

O aditivo 0.4.4 passou 83 testes web, 206 verificações do desktop, testes puros do serviço e 16 verificações do atualizador. WPF e serviço compilaram em Release sem avisos; o MSI passou pela inspeção estrutural. Os testes não executaram desligamento, reinício, hibernação nem alteração de política.

A instalação elevada, aplicação efetiva das políticas, relançamento em outra conta, as três ações reais e a desinstalação precisam de homologação em VM/computador piloto. O pacote não instala certificado, não modifica domínio e não desativa UAC ou antivírus.
