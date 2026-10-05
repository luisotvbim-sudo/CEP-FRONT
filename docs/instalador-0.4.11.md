# Instalador CEP Horas 0.4.11

Entrega de 05/10/2026, `codex/instalador-pronto`. Integra Front/main `53d8e5be438e18b2c67e7bcff82f8806330ada8e` ao serviço/atualizador e à refatoração do piloto 0.4.10. API compatível: main `ba07f772f3ed9914a80ef9dfa4543385a742ecea`. Não exige novo endpoint ou migration além do acompanhamento pessoal já integrado.

## Comportamento entregue

- Minha jornada e Meu histórico separados, consulta oficial automática e bridge com `RetryAfterSeconds`, sem tokens no renderer.
- Recuperação WPF exige React/bridge funcionais e preserva perfil/sessão conforme o contrato de lifecycle.
- Antes de executar energia, o serviço persiste e faz flush da intenção privada `preparing`. Só então inicia os dez segundos e publica `scheduled`.
- Inicialização valida o journal privado; estado inválido/ilegível impede serviço pronto. Não repete nem cancela ações automaticamente.
- Após restart, intenção herdada bloqueia novos agendamentos e manutenção mesmo que seu prazo já tenha passado. Somente seu SID recebe ID/action/origem. WPF novo adota esse ID para cancelamento explícito, sem nova autorização API ou dispatch.
- Cancelamento requer ID/SID/origem correspondentes. Erro do executor preserva incerteza. Ausência de desligamento confirmada pelo Windows permite concluir; outros erros não são convertidos em sucesso.
- Cancelamento anterior ao dispatch precisa de tombstone durável. Falha de disco anterior ao efeito impede agendamento. Falha de disco posterior ao efeito não oculta o resultado real, mas bloqueia novos efeitos até persistência reconciliada. Tombstones de quinze minutos impedem replay.
- O kit TI inclui `Verificar-Windows.ps1`, somente leitura e sem dados pessoais, para conferir edição/build/x64/WebView2. Mantido Windows 11 x64 Pro/Enterprise/Education 24H2+; a frota foi esclarecida como Windows 11, ainda sem edição/build de todas as máquinas.

O journal pertence ao diretório restrito de ProgramData, nunca ao payload ou aos documentos. `AbortSystemShutdown` é global no Windows: o journal identifica a intenção CEP, mas não identifica outra ação de terceiro que tenha substituído o agendamento. Administradores/SYSTEM, GPO, reinício crítico, firmware e corte de energia continuam fora da garantia.

## Identidade e distribuição

A chave de publicação DPAPI antiga foi encontrada e validada contra a chave pública embutida, sem expor valores. Não houve geração ou rotação de identidade. O manifesto RSA-PSS/SHA256 será produzido pela mesma identidade durante o build; esse mecanismo é distinto de Authenticode.

O serviço antigo presente nesta estação é 0.4.7 e não tem Authenticode; MSI antigo 0.4.9 também `NotSigned`. Nenhum certificado de assinatura de código válido com chave privada foi encontrado nos stores pessoais/de máquina. Backup portátil protegido da chave é suportado pelo script existente, mas sua exportação/recuperação ainda precisa ser conferida pela TI.

```powershell
./scripts/check-corporate-windows.ps1
./scripts/build-corporate-msi.ps1 -Version 0.4.11 -UpdateSigningKeyPath <arquivo-DPAPI-privado>
```

O kit resultante inclui MSI, guia TI, verificador Windows, hashes, recuperação administrativa e manifesto/assinatura. Nunca incluir chave privada/certificado com privada no release ou kit. Registro exato de origem/hashes/checks fica em `BUILD-EVIDENCE.json` junto ao artefato e no orquestrador.

## Validação e aceite

Lint/build e 100 testes web passaram; 212 testes de navegador passaram. Testes nativos passaram: duas suites legadas e 108 verificações de confiabilidade, 41 de recuperação durável, 296 de sessão/storage/bridge e 16 + 4 + 80 do atualizador/preflight. Todos os executores de energia usados nesses testes são falsos.

Build estrutural do MSI e driver WPF serão registrados após sua conclusão. Nenhuma instalação elevada, mudança de política ou ação real de energia foi feita nesta entrega. Piloto autorizado ainda precisa conferir instalação/upgrade da versão presente para 0.4.11, conta comum, crash/cancelamento, repair/uninstall/rollback, multiusuário/GPO e recuperação do publicador. Só depois ativar a distribuição estável da frota. CI e manifesto assinado não substituem esse aceite.
