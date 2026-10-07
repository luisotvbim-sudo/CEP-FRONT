import { useEffect } from 'react'
import { ArrowDownToLine, ArrowRight, Monitor } from 'lucide-react'
import logo from '../assets/conceito-logo.png'
import icon from '../assets/conceito-icon.png'
import './download.css'

const desktopRelease = {
  version: '0.4.19',
  download: 'https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/installer-v0.4.19/CEP-Horas-Windows-win-x64.msi',
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
          </div>
          <div className="download-card">
            <div className="download-app-icon"><img src={icon} alt="" width="72" height="88" /></div>
            <h2>CEP Horas para Windows</h2>
            <p className="download-platform"><Monitor size={16} aria-hidden="true" /> Windows 10 22H2 / Windows 11 24H2+ · x64</p>
            <p className="download-platform">Pro / Enterprise / Education</p>
            <p className="download-platform">Instalação pela TI · WebView2 por máquina.</p>
            <span className="download-test-badge">Piloto manual · {desktopRelease.version} · MSI</span>
            <p className="download-pilot-notice">Instale com acompanhamento da TI. O upgrade 0.4.19 foi testado em Windows 11; esta versão ainda precisa de piloto específico em Windows 10. O MSI não tem assinatura digital do editor (Authenticode), então o Windows pode exibir um aviso de confiança. Esta versão não está no canal de atualização automática.</p>
            <a className="download-primary" href={desktopRelease.download}><ArrowDownToLine size={20} aria-hidden="true" /> Baixar para Windows</a>
          </div>
        </section>
      </main>
      <footer className="download-footer"><span>© {new Date().getFullYear()} Conceito Engenharia</span><span>CEP Horas · Windows e web</span></footer>
    </div>
  )
}
