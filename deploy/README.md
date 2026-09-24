# Produção web

O front web roda em um contêiner próprio e não publica portas no host. Ele entra na rede externa `cep-api-production_frontend` com o alias `cep-front`. O Nginx de borda da CEP API **precisa** encaminhar `cep.lat` para esse alias e `/api/` diretamente para a API. Assim o navegador usa uma única origem: o access token fica somente em memória, o refresh token fica em cookie `HttpOnly` gerido pela API, e CORS não precisa ser aberto.

## Pré-requisito no CEP-API (responsabilidade do deploy de borda)

O checkout local do `CEP-API` consultado em 24/09/2026 ainda só possui o virtual host de `api.cep.lat`; ele **não** publica `cep.lat`. Antes de implantar este front, o responsável pelo deploy da API deve configurar DNS/certificado para `cep.lat` e o virtual host HTTPS na borda, encaminhando `/api/` a `api:8080` e o restante a `cep-front:8080` na rede `cep-api-production_frontend`. Preservar `Host`, `Origin`, `Cookie` e `Set-Cookie`; encaminhar corretamente o esquema HTTPS ao backend e manter as chaves Data Protection persistentes. Não expor a porta 8080 nem habilitar CORS para contornar a falta do proxy.

O Nginx interno do front rejeita `/api/` com `404` de propósito: uma rota de API enviada ao contêiner errado não pode receber `index.html` com `200`.

## Primeira implantação

Na VM, use `/opt/cep-front`, checkout destacado da `main` e um `.env` baseado em `production.env.example`:

```bash
cp deploy/production.env.example .env
mkdir -p .local
git checkout --detach main
docker build -t "cep-front:$(git rev-parse --short=12 HEAD)" .
sed -i "s/^FRONT_IMAGE_TAG=.*/FRONT_IMAGE_TAG=$(git rev-parse --short=12 HEAD)/" .env
docker compose --env-file .env -f compose.production.yaml up -d --wait
git rev-parse HEAD > .local/deployed-commit
curl -fsS https://cep.lat/healthz
```

A rede da API precisa existir antes de iniciar o front. Somente o Nginx da API publica 443. Não publique 8080 e não combine este Compose com arquivos de desenvolvimento.

Após configurar a borda, validar **antes** de liberar usuários:

```bash
curl -fsS https://cep.lat/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://cep.lat/api/v1/me
```

Sem sessão, `/api/v1/me` deve responder `401` da API (não HTML do front, nem `404`/`502`). Em seguida, homologar login, refresh, logout e permissões com contas de teste autorizadas; a checagem anônima não valida fluxos reais. O `.env` do Compose permanece apenas na VM e é excluído do contexto Docker.

Depois da primeira implantação, instale `deploy/nightly/install.sh` e `deploy/monitoring/install.sh`. A VM verifica a `main` diariamente às 02:15 em São Paulo, quinze minutos depois da API. O atualizador exige CI aprovada para o SHA exato, compila antes da troca, usa tag imutável e retorna à imagem anterior se o health check falhar.
