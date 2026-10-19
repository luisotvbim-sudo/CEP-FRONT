# Base integrada da refatoração — CEP-FRONT — 19/10/2026

Branch `codex/refactor-cep-20261019`: o MSI publicado 0.4.22 (`723fd35`) foi integrado com a `main` web (`491059c`) no merge `9adfeac`. A página `/download` aponta à prerelease manual 0.4.22. O antigo candidato de recuperação Windows foi reaplicado em sete commits até `5aa2fda`, mas suas CIs antigas não validam esta base. Não houve mudança de contrato API; `docs/openapi.json` tem o mesmo SHA-256 que `CEP-API/docs/openapi-current.json` na base `fff8958`.

## Verificação da branch integrada

- `pnpm lint`, 141 testes Vitest e `pnpm build`: passaram após o merge web. As alterações Windows não modificam o código React.
- `dotnet build desktop/CepHoras.Desktop -c Debug` e `-c Release`: passaram com zero aviso/erro após a recuperação.
- `CepHoras.Desktop.Tests`: 475 verificações; `CepHoras.Control.Tests`: suites de serviço, 110 asserções de confiabilidade e 45 verificações de recuperação durável; `CepHoras.Updates.Tests`: 80 verificações do atualizador e preflight, todos aprovados com executores falsos.
- `node scripts/test-desktop-init-failure.mjs`: passou em processo filho isolado; falha de setup do host não inicia recuperação WebView2.
- `pnpm test:e2e`: 247/248 na primeira execução. A falha foi timeout antes de localizar o campo de e-mail no login de um caso de busca administrativa desktop. O caso passou isoladamente e cinco vezes em paralelo. A CI do SHA final deve ser observada para descartar recorrência.
- Primeira CI do PR de recuperação: o teste mobile de sessão expirada durante o PIN falhou porque o helper ainda procurava o campo depois de o logout desmontar o menu. A asserção agora verifica o campo limpo somente se o menu permanece; no caso 401 verifica a saída para login, menu ausente e ausência de operação nativa. Dez repetições desktop/mobile passaram localmente. Conferir a CI do novo SHA.
- `./scripts/build-corporate-msi.ps1 -Version 0.4.23`: gerou MSI local e passou na inspeção estrutural de payload, serviço, política e rollback. SHA-256 `492cd8009eb7ca814219158a1d3a2b0662c677d7489bcee614ea9c5a11f05270`. Build sem assinatura do manifesto; não é distribuição nem canal automático.

A revisão independente solicitada pelo programa #54 não encontrou defeito reproduzível em WebView/journal nesta passada e executou testes dirigidos. Ela não verificou serviço/WebView real, instalação, repair/rollback MSI ou energia em PC piloto. Não publicar este MSI como release antes desses gates. A API e os PCs instalados possuem evidências próprias e não são representados pelo SHA deste repositório.
