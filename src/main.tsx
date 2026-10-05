import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import './styles.css'
import { App } from './App'
import { HttpAuthClient } from './auth/auth-client'
import { DesktopAuthClient } from './auth/desktop-auth-client'
import { DownloadPage } from './download/DownloadPage'
import { DesktopLifecycle, DesktopErrorBoundary } from './desktop/DesktopLifecycle'

const root = createRoot(document.getElementById('root')!)

// This preview is excluded by Vite from production, including its fixtures.
if (location.pathname.replace(/\/$/, '') === '/download') {
  root.render(
    <StrictMode>
      <DownloadPage />
    </StrictMode>,
  )
} else if (
  import.meta.env.DEV &&
  new URLSearchParams(location.search).get('preview') === 'analysis'
) {
  void import('./preview/AnalysisPreview').then(({ AnalysisPreview }) => {
    root.render(
      <StrictMode>
        <AnalysisPreview />
      </StrictMode>,
    )
  })
} else if (window.__CEP_DESKTOP__ && !window.chrome?.webview) {
  root.render(
    <div role="alert">A comunicação nativa está indisponível. Use Recarregar interface.</div>,
  )
} else {
  const client =
    window.__CEP_DESKTOP__ && window.chrome?.webview
      ? new DesktopAuthClient(window.chrome.webview)
      : new HttpAuthClient()
  root.render(
    <StrictMode>
      <DesktopLifecycle>
        <DesktopErrorBoundary>
          <App client={client} />
        </DesktopErrorBoundary>
      </DesktopLifecycle>
    </StrictMode>,
  )
}
