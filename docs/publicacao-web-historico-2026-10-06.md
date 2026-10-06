# Publicação web do histórico pessoal — 06/10/2026

Registro operacional da entrega dos [PRs Front #25](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/25) e [#26](https://github.com/luisotvbim-sudo/CEP-FRONT/pull/26). O #25 entrou na `main` por merge commit `db79c63f1086be4176379446ff283770bdb96086`; o #26, por `eb6856ea2764ac6b8f063209a70bcd4f674211fb`. Os jobs `validate` e `desktop` passaram no [CI da `main` após #25](https://github.com/luisotvbim-sudo/CEP-FRONT/actions/runs/37544363536) e no [CI da `main` final](https://github.com/luisotvbim-sudo/CEP-FRONT/actions/runs/37544852865). Os PRs #21–#23 permaneceram fora desta entrega.

## Implantação e checagens públicas

Após o CI do SHA final, uma única execução de `cep-front-update.service` concluiu com `Result=success` e `ExecMainStatus=0`. Na VM, `HEAD` e `.local/deployed-commit` indicaram `eb6856ea2764ac6b8f063209a70bcd4f674211fb`. O contêiner `cep-front:eb6856ea2764` usou a imagem `sha256:15df4e8313db62abf1c71d75a0c287266261e33555909c0f2c750c83adec87de` e ficou `running/healthy`. O contêiner da API independente estava `running/healthy` na imagem `cep-api:78a71e4c6d63`.

`https://cep.lat/healthz` e `https://plugincep.com.br/healthz` responderam HTTP 200 com `healthy`. `/download` respondeu HTTP 200 nos dois domínios. O bundle servido por ambos, `/assets/index-PVQXYCMF.js`, continha o destino `installer-v0.4.16/CEP-Horas-Windows-win-x64.msi` e o requisito Windows 10 22H2. Isso confirma o link apresentado pelo front; não equivale a instalar ou homologar o MSI.

## Conferência autenticada e limite

Na sessão produtiva já existente de coordenador em `plugincep.com.br`, a página Pessoas carregou. `Ver histórico` consultou 01–06/10 e retornou 40 registros. A interface mostrou “Faltando no Monday” nos dias com diferença negativa e “Diferença indisponível” nos dias incompletos. A expansão de um dia exibiu Monday e VR Mais. A conferência foi somente leitura, sem sincronização ou outra mutação. Não foram registrados nomes, batidas, tokens ou identificadores pessoais.

A sessão de coordenador não apresenta **Minha jornada** de usuário comum; essa tela não foi conferida autenticada diretamente em produção. Antes da publicação, ela foi conferida com conta de usuário no laboratório Docker local, incluindo situação, três cartões, histórico do período e rótulos direcionais. O [Issue central #33](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/33) permanece aberto para o aceite autenticado dessa tela em produção.

Este registro é somente documental. Sua integração à `main` não troca a imagem da VM: o SHA funcional implantado permanece `eb6856ea2764ac6b8f063209a70bcd4f674211fb` até outro deploy autorizado e verificado.
