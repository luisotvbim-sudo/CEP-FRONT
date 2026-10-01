# Instalador corporativo integrado

Implementação de 30/09/2026 na branch `codex/installer-integrado`, construída sobre o menu autenticado e o contrato da CEP API `cf15a5c`.

## Componentes

- Um único MSI por máquina instala React/WPF, o serviço `CepHorasControl`, inicialização em cada logon e a recuperação da TI.
- O serviço roda como `LocalSystem`. Usuário comum não recebe permissão para parar ou configurar o serviço.
- O WPF fecha para a bandeja, não oferece **Sair** ao usuário comum e é relançado pelo serviço quando finalizado na sessão local ativa.
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
./scripts/build-corporate-msi.ps1 -Version 0.4.0
```

Os testes do serviço usam um executor falso e não alteram política nem energia. O teste MSI lê o banco do pacote sem instalar e verifica escopo, serviço, custom actions elevadas, rollback, restauração antes da remoção, ACL e payload.

A instalação elevada, aplicação efetiva das políticas, relançamento em outra conta, as três ações reais e a desinstalação precisam de homologação em VM/computador piloto. O pacote não instala certificado, não modifica domínio e não desativa UAC ou antivírus.
