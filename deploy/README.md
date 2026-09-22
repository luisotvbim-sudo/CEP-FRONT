# Produção web

O front web roda em um contêiner próprio e não publica portas no host. Ele entra na rede externa `cep-api-production_frontend` com o alias `cep-front`; o Nginx de borda da CEP API encaminha `app.cep.lat` para esse alias e encaminha `/api/` diretamente para a API. Assim o navegador usa uma única origem, os tokens continuam apenas em memória e CORS não precisa ser aberto.

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
curl -fsS https://app.cep.lat/healthz
```

A rede da API precisa existir antes de iniciar o front. Somente o Nginx da API publica 443. Não publique 8080 e não combine este Compose com arquivos de desenvolvimento.

Depois da primeira implantação, instale `deploy/nightly/install.sh` e `deploy/monitoring/install.sh`. A VM verifica a `main` diariamente às 02:15 em São Paulo, quinze minutos depois da API. O atualizador exige CI aprovada para o SHA exato, compila antes da troca, usa tag imutável e retorna à imagem anterior se o health check falhar.
