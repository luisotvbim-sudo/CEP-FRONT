import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import './styles.css'
import { App } from './App'
import { HttpAuthClient } from './auth/auth-client'
import { DesktopAuthClient } from './auth/desktop-auth-client'

const client =
  window.__CEP_DESKTOP__ && window.chrome?.webview
    ? new DesktopAuthClient(window.chrome.webview)
    : new HttpAuthClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
)
