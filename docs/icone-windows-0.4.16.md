# Ícone nativo do CEP Horas — MSI 0.4.16

Demanda: [CEP-ORQUESTRADOR #27](https://github.com/luisotvbim-sudo/CEP-ORQUESTRADOR/issues/27).

O PNG reduzido fornecido pelo usuário é byte a byte igual ao recurso
`src/assets/conceito-icon.png` já versionado (SHA-256
`c0131e2de05a43fbd3b7230d545e9477ac7fe5d8b09dfd7ffae7740d1322032e`).
Não houve redesenho nem alteração do asset web. O script
`scripts/new-windows-icon.ps1` produz um ICO transparente com quadros de 16,
20, 24, 32, 40, 48, 64, 128 e 256 pixels a partir desse PNG. O ICO gerado
fica versionado em `desktop/CepHoras.Desktop/Assets/Conceito.ico`.

O executável WPF incorpora o ícone de aplicativo; a janela declara o mesmo
recurso para a barra de tarefas. A bandeja carrega o quadro de 16 pixels do
recurso WPF em vez do símbolo de informação do Windows. O MSI usa o ícone
na tabela `Icon`, nos atalhos de menu Iniciar e área de trabalho e em
Aplicativos instalados. Como o MSI é por máquina (`ALLUSERS=1`), o atalho
`DesktopFolder` é dirigido à área de trabalho pública, visível para todos
os usuários. O instalador por perfil usa o ícone do executável; o gerador
MSIX já usava o mesmo PNG.

Verificações: hash do PNG fornecido comparado ao asset versionado; ICO aberto
como ícone 16x16 e quadros inspecionados; build WPF Release e driver real
WPF/WebView2 em fixture descartável passaram. O build WiX de inspeção
confirmou a tabela de ícones e os dois atalhos, sem instalar o pacote.
Build final, CI, publicação e aparência depois do upgrade serão registrados
separadamente. Atalhos antigos fixados na barra de tarefas podem conservar
o ícone em cache; desafixar e fixar novamente pode ser necessário.
