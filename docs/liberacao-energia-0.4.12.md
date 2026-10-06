# Liberação dos controles ao fechar — 0.4.12

Correção da [Issue central #19](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/19), aberta após instalação local autorizada da 0.4.11 em 05/10/2026. O fechamento com senha diária restaurava corretamente as atribuições LSA e registros salvos, mas Explorer e menu Iniciar continuavam sem `SeShutdownPrivilege` em seus tokens. A notificação do shell não acrescenta privilégios ausentes a uma sessão existente. [Documentação Microsoft](https://learn.microsoft.com/en-us/windows/win32/secbp/changing-privileges-in-a-token).

O usuário escolheu explicitamente **Liberar imediatamente ao fechar com a senha diária**, informado de que isso permite desligamento por comandos externos. Essa decisão modifica o perfil anterior: o CEP preserva os direitos de desligamento originais da máquina e restringe menus, tela sem login e botões físicos/tampa por registros restauráveis. Não concede direitos que a organização não possuía antes. GPO e restrições originais continuam prevalecendo.

## Aplicação e migração

O perfil de política privado passa à versão 3, com o mesmo snapshot original e o mesmo armazenamento restrito Administradores/SYSTEM. Leitura/restauração aceitam também a versão 2. Nova instalação conserva as atribuições LSA; a verificação compara essas atribuições com o snapshot, sem substituir a lista pelo grupo Administradores/SYSTEM. Retomada, eventos de sessão e restart do serviço não removem mais direitos de logon.

Migração de uma configuração versão 2 ativa verifica primeiro a política anterior. Grava estado `applying` antes do primeiro efeito; restaura as atribuições originais enquanto mantém os registros de bloqueio; verifica e confirma versão 3 ativa. Falhas restauram o perfil anterior, incluindo seu estado ativo. Falha adicional de rollback preserva o snapshot e o marcador incompleto para recuperação pela TI. Alteração externa é recusada. Uma versão 2 já restaurada é aplicada pelo caminho normal, preservando seu estado corrente no novo snapshot.

Upgrade MSI agenda um checkpoint privado de configuração e estado anterior antes da migração e antes de iniciar o serviço novo. Uma ação rollback restaura ambos, inclusive o schema compreendido pelos binários antigos, caso uma etapa posterior falhe. O checkpoint só é removido no commit MSI após verificar o perfil novo. Journals pendentes são preservados e impedem iniciar outra migração. Os comandos TI restritos `--rollback-policy-upgrade` e `--finish-policy-upgrade` permitem resolver o checkpoint com a versão atual após revisar o resultado da instalação.

Fechamento com senha continua exigindo serviço instalado, ausência de manutenção e uma única sessão ativa. Restaura o snapshot, suspende supervisão e notifica o shell na sessão do usuário. Retomada reaplica registros e supervisão. Credenciais, decisão da API, journal/cancelamento de energia e trust do atualizador permanecem com seus contratos existentes.

## Sessões criadas pelas versões anteriores

Sessões que já perderam `SeShutdownPrivilege` precisam sair e entrar no Windows **uma vez**, depois da atualização e com trabalho salvo. O host faz leitura dos privilégios do próprio processo e orienta essa renovação ao fechar quando a permissão está ausente. Não força logoff, reboot, reinício do Explorer ou qualquer ação de energia. Depois de obter um token com os direitos originais, abrir/fechar o CEP não remove mais essa permissão.

Se a política original/GPO não permite desligar, a correção preserva essa restrição; não prometer liberação contra ela. O perfil anterior não oferecia restauração instantânea de tokens, e o perfil novo não promete impedir programas externos que usam direitos já presentes.

## Validação e limites

Testes com executores falsos verificam preservação de direitos originais, restrição prévia, migração ativa, backup antes dos efeitos, verificação, rollback e backup preservado após falha dupla. Testes do host verificam leitura nativa e distinção entre direito ausente e presente/desabilitado. Não executam desligamento, reinício ou hibernação.

MSI 0.4.12 é uma nova entrega; os artefatos/manifestos 0.4.11 permanecem imutáveis. Build/CI não comprovam fechamento na sessão renovada. Registrar instalação e teste visual do usuário separadamente. Não publicar canal estável sem homologação. A sequência MSI contém rollback da migração para a versão anterior, mas rollback MSI real ainda precisa de piloto. Downgrade após uma atualização já confirmada exige a ferramenta TI atual e reinstalação planejada, nunca troca isolada de executáveis.
