# Instruções para agentes do CEP-FRONT

Antes de escrever ou alterar qualquer integração com o backend:

1. Leia `README.md` para entender o produto, as decisões de segurança e o estado real da API.
2. Leia `docs/openapi.json`; ele é o contrato versionado da CEP API disponível para o front.
3. Se a API local estiver rodando, execute `./scripts/sync-openapi.ps1` antes de trabalhar na integração.
4. Use `http://127.0.0.1:8080` como URL local da API e `http://127.0.0.1:8080/swagger` para inspeção humana.
5. Não invente endpoints, campos, enums ou permissões ausentes do OpenAPI. Quando a necessidade do front ainda não estiver no contrato, registre a dependência do backend explicitamente.
6. Não chame Monday ou VR Mais diretamente. Toda integração externa passa pela CEP API, e nenhum token externo pertence ao front.
7. Um Swagger acessível não significa que o banco esteja disponível. Sem PostgreSQL, use o contrato e mocks; não afirme que fluxos de dados reais foram validados.

Quando a API mudar, atualize e versione `docs/openapi.json` no mesmo trabalho que adaptar o cliente do front.

Para produção web, preserve a separação descrita em `deploy/README.md`: este repositório gera apenas o contêiner `cep-front`, sem porta publicada; o Nginx de borda encaminha `app.cep.lat` ao front e `/api/` diretamente ao contêiner independente da CEP API. Não habilite CORS nem mude o cliente para guardar tokens no navegador. Mudanças em Docker, Nginx ou deploy precisam validar `compose.production.yaml`, a imagem read-only sem privilégios, os scripts Bash e o health check `/healthz`.
