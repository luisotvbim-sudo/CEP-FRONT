import { useEffect } from 'react'
import { ArrowDownToLine, ArrowRight, BellRing, Check, ExternalLink, Monitor, PanelTop, ShieldCheck } from 'lucide-react'
import logo from '../assets/conceito-logo.png'
import icon from '../assets/conceito-icon.png'
import './download.css'

export const desktopRelease = {
  version: '0.2.0.1',
  url: 'https://github.com/luisotvbim-sudo/CEP-FRONT/releases/tag/desktop-v0.2.0.1-test',
  download: 'https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/desktop-v0.2.0.1-test/CEP-Horas-Windows.zip',
  checksum: 'https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/desktop-v0.2.0.1-test/SHA256SUMS.txt',
}

export function DownloadPage() {
  useEffect(() => { document.title = 'Download para Windows · CEP Horas' }, [])

  return (
    <div className="download-shell">
      <header className="download-header">
        <a href="/" aria-label="CEP Horas — início"><img src={logo} alt="Conceito Engenharia" width="1174" height="376" /></a>
        <span className="download-product">CEP <strong>Horas</strong></span>
        <a className="download-web-link" href="/">Acessar pelo navegador <ArrowRight size={16} aria-hidden="true" /></a>
      </header>

      <main id="conteudo">
        <section className="download-hero" aria-labelledby="download-title">
          <div className="download-intro">
            <span className="download-eyebrow"><span /> SEU ESPAÇO DE TRABALHO</span>
            <h1 id="download-title">Seu CEP Horas.<br /><em>Agora no Windows.</em></h1>
            <p className="download-lead">Acompanhe seus registros e receba avisos no computador, com as mesmas telas e a mesma conta que você usa no navegador.</p>
            <ul className="download-benefits">
              <li><BellRing size={21} aria-hidden="true" /><span><strong>Avisos no Windows</strong><small>Receba notificações com o aplicativo na bandeja.</small></span></li>
              <li><PanelTop size={21} aria-hidden="true" /><span><strong>A experiência que você conhece</strong><small>Suas telas, seus acessos e sua organização.</small></span></li>
              <li><ShieldCheck size={21} aria-hidden="true" /><span><strong>Sua conta, protegida</strong><small>Entre com sua conta autorizada do CEP Horas.</small></span></li>
            </ul>
          </div>

          <div className="download-card">
            <div className="download-app-icon"><img src={icon} alt="" width="72" height="88" /></div>
            <h2>CEP Horas para Windows</h2>
            <p className="download-platform"><Monitor size={16} aria-hidden="true" /> Windows 10/11 · 64 bits (x64)</p>
            <span className="download-test-badge">Versão de teste · {desktopRelease.version}</span>
            <a className="download-primary" href={desktopRelease.download}><ArrowDownToLine size={20} aria-hidden="true" /> Baixar para Windows</a>
            <p className="download-file-info">Arquivo ZIP · Download pelo GitHub</p>
            <div className="download-release-note"><strong>Antes de começar</strong><p>Este pacote ainda não tem assinatura digital nem atualização automática. O instalador MSIX assinado será disponibilizado em uma próxima versão.</p></div>
            <div className="download-release-links"><a href={desktopRelease.url} target="_blank" rel="noreferrer">Detalhes da versão <ExternalLink size={13} aria-hidden="true" /></a><a href={desktopRelease.checksum}>Verificação SHA-256</a></div>
          </div>
        </section>

        <section className="download-setup" aria-labelledby="setup-title">
          <div className="download-section-heading"><span className="download-eyebrow">PRIMEIROS PASSOS</span><h2 id="setup-title">Pronto para começar?</h2><p>Confira os requisitos e abra o aplicativo em três passos.</p></div>
          <ol className="download-steps">
            <li><span className="download-step-number">01</span><h3>Prepare seu computador</h3><p>Tenha o <strong>.NET Desktop Runtime 10 x64</strong> e o <strong>Microsoft Edge WebView2 Runtime</strong> instalados.</p><a href="https://dotnet.microsoft.com/pt-br/download/dotnet/10.0" target="_blank" rel="noreferrer">Baixar .NET Desktop Runtime <ExternalLink size={13} aria-hidden="true" /></a><a href="https://developer.microsoft.com/microsoft-edge/webview2/#download-section" target="_blank" rel="noreferrer">Baixar WebView2 Runtime <ExternalLink size={13} aria-hidden="true" /></a></li>
            <li><span className="download-step-number">02</span><h3>Extraia e abra</h3><p>Baixe o ZIP e escolha <strong>Extrair tudo</strong>. Na pasta extraída, abra <code>app\CepHoras.exe</code>. Mantenha todos os arquivos juntos.</p></li>
            <li><span className="download-step-number">03</span><h3>Entre e teste os avisos</h3><p>Use sua conta do CEP Horas. No ícone da bandeja do Windows, clique com o botão direito e escolha <strong>Testar notificação</strong>.</p></li>
          </ol>
        </section>

        <section className="download-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">Antes do primeiro acesso</h2>
          <details><summary>Preciso instalar um servidor no meu computador?</summary><p>Não. O aplicativo se conecta à API do CEP Horas pela internet. Você precisa apenas dos requisitos acima e de uma conta autorizada.</p></details>
          <details><summary>O que acontece quando fecho a janela?</summary><p>O CEP Horas continua na bandeja para receber avisos. Para encerrá-lo, escolha <strong>Sair do aplicativo</strong> no menu do ícone. Para desconectar sua conta, use <strong>Sair da conta</strong> dentro do aplicativo.</p></details>
          <details><summary>Como crio um atalho no menu Iniciar?</summary><p>O pacote inclui <code>install.ps1</code> para instalação por usuário e criação de atalho. Se precisar, peça ajuda ao responsável de TI. O script não substitui uma instalação existente.</p></details>
          <details><summary>Por que não apareceu um popup?</summary><p>Confira as configurações de notificações e o modo Não perturbe do Windows. Os avisos reais dependem de uma sessão válida e conexão com a API. A central do CEP Horas mantém as mensagens, mesmo quando o Windows não exibe o popup.</p></details>
        </section>

        <div className="download-browser-note"><Check size={18} aria-hidden="true" /><p>Prefere continuar na web? O CEP Horas também está disponível no navegador.</p><a href="/">Acessar CEP Horas <ArrowRight size={16} aria-hidden="true" /></a></div>
      </main>
      <footer className="download-footer"><span>© {new Date().getFullYear()} Conceito Engenharia</span><span>CEP Horas · Windows e web</span></footer>
    </div>
  )
}
