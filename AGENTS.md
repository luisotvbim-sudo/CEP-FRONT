# Instruções para agentes do CEP-FRONT

Antes de escrever ou alterar produto ou integração com o backend:

1. Leia `docs/produto/especificacao-funcional.md`; ela é a fonte de verdade funcional e separa capacidades entregues, parciais e planejadas.
2. Leia `docs/compatibilidade-backend.md` e `README.md` para entender o estado real da API e os limites entre backend e interface.
3. Leia `docs/openapi-backend-current.json`; ele é o snapshot do contrato realmente exposto pela branch de backend de referência.
4. Mantenha `docs/openapi.json`, o snapshot real e `src/auth/api-schema.d.ts` alinhados quando rotas ou schemas mudarem.
5. Se a API local estiver rodando, atualize o snapshot real com `./scripts/sync-openapi.ps1 -OutputPath ./docs/openapi-backend-current.json` antes de trabalhar na integração.
6. Use `http://127.0.0.1:8080` como URL local da API e `http://127.0.0.1:8080/swagger` para inspeção humana.
7. Não invente endpoints, campos, enums ou permissões ausentes do contrato real. Quando a necessidade do front ainda não estiver disponível, registre a dependência do backend explicitamente.
8. Não chame Monday ou VR Mais diretamente. Toda integração externa passa pela CEP API, e nenhum token externo pertence ao front.
9. Um Swagger acessível não significa que o banco esteja disponível. Sem PostgreSQL, use o contrato e mocks; não afirme que fluxos de dados reais foram validados.

Quando a API mudar, atualize e versione primeiro `docs/openapi-backend-current.json`. Substitua `docs/openapi.json`, regenere `src/auth/api-schema.d.ts` e adapte o cliente no mesmo trabalho somente quando o front puder consumir integralmente o novo contrato.

Para produção web, preserve a separação descrita em `deploy/README.md`: este repositório gera apenas o contêiner `cep-front`, sem porta publicada; o Nginx de borda encaminha `cep.lat` ao front e `/api/` diretamente ao contêiner independente da CEP API. Não habilite CORS nem mude o cliente para guardar tokens no navegador. Mudanças em Docker, Nginx ou deploy precisam validar `compose.production.yaml`, a imagem read-only sem privilégios, os scripts Bash e o health check `/healthz`.
