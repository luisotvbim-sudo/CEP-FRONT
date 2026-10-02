# Implementação de análises e notificações

Entrega de 29/09/2026, integrada ao contrato real da CEP API desta mesma entrega. Os snapshots `openapi-backend-current.json`, `openapi.json` e os tipos gerados precisam ser publicados junto com o cliente. Implantar primeiro o backend correspondente.

## Interface autenticada

- Coordenadores e SystemAdmin acessam configurações globais, tolerância simétrica e agendas com horário, finalidade e mensagem. Edição e exclusão incluem a versão do registro; conflitos exigem recarregar. A tela informa que a mudança alcança todas as organizações.
- Envio instantâneo aceita uma pessoa associada a uma conta ou todos os destinatários elegíveis do escopo. Prévia de destinatários, datas e corte vem do servidor. Diário, semanal e sprint são regras do backend. A confirmação é invalidada ao editar o envio; uma resposta de rede incerta conserva a chave de idempotência.
- Histórico distingue solicitação na fila de processamento concluído; não afirma entrega ao Windows. A central pessoal permite ler explicitamente; abrir o detalhe não marca leitura nem corrige as horas.
- Análises exibem totais, diferenças, dias parciais, problemas e situação das fontes recebidos da API. O navegador não recalcula jornadas, tolerâncias ou períodos. Dados ausentes continuam indisponíveis. Relatórios filtram período, pessoa, dia e tipo de ocorrência no servidor.
- SystemAdmin pode abrir configurações globais e a própria central sem selecionar uma organização. Operações de pessoas e envio exigem organização selecionada. Líder/membro recebem apenas a consulta autorizada pela API.

## Windows

- WPF permanece na bandeja ao fechar a janela. O menu oferece abrir, abrir a central, testar um popup local e fechar o aplicativo mediante a senha diária offline do MSI 0.4.4. A instalação por usuário registra início em segundo plano em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`; builds portáteis e Debug não alteram a inicialização. MSIX usa a tarefa do manifesto. Veja [aplicativo Windows](aplicativo-windows.md); assinatura e instalação MSIX ainda precisam de homologação.
- O host nativo consulta pendentes após login/retomada e a cada minuto. Coleta todas as páginas antes de confirmar recebimento para não deslocar resultados da paginação.
- Identificadores recebidos são persistidos com DPAPI, separados pela origem da API e pela conta. Nenhum token ou corpo de mensagem entra no React ou nesse arquivo de recibos. O arquivo não contém uma cópia offline das análises; detalhes continuam na central autenticada.
- Um popup resume o lote de pendentes. Novas chegadas próximas são agrupadas, com intervalo mínimo de cinco minutos entre popups. A central conserva cada mensagem com sua data original. Recebimento não equivale a leitura.
- Falha na consulta ou confirmação é retomada no próximo ciclo. Sem conectividade de rede ao iniciar, o arquivo de sessão é preservado e a retomada é tentada novamente. Uma resposta incerta durante rotação de refresh exige login, preservando a proteção contra replay já existente.
- A configuração de notificações do Windows/Não perturbe pode suprimir um popup; a central permanece a referência de mensagens. O Windows não calcula horas. O instalador corporativo aplica o controle local de energia, mas a decisão online vem do endpoint autenticado da CEP API; somente a indisponibilidade real do transporte ativa a contingência local.

## Validação

Testes de contrato verificam escopo global versus organizacional, chave de idempotência e central pessoal. Playwright cobre configurações, exclusão, confirmação/retentativa de envio, valores desconhecidos, leitura explícita e acessibilidade. O teste WPF/WebView2 com API descartável verifica 101 pendentes em duas páginas, confirmação após coleta, recibos DPAPI, reinício e preservação dos tokens no host.

Essa validação com dados fictícios não comprova cobertura Monday/VR real nem assinatura/publicação do instalador. O fluxo autenticado com dados reais e as políticas de notificação do Windows de cada estação precisam de homologação operacional.
