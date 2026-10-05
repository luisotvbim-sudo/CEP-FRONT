import { Component, useEffect, type ReactNode } from 'react'

// This handshake observes local rendering only. API/session requests may still
// be pending or fail while the native host considers the renderer healthy.
export function DesktopLifecycle({ children }: { children: ReactNode }) {
  useEffect(() => {
    const bridge = window.chrome?.webview
    if (!window.__CEP_DESKTOP__ || !bridge) return
    const listener = (event: { data: unknown }) => {
      const message = event.data as { type?: string; version?: number; token?: string }
      if (message?.type === 'cep-inbox-open' && typeof message.token === 'string') {
        window.__CEP_INBOX_INTENT__ = message.token
        window.dispatchEvent(new Event('cep-open-notifications'))
        return
      }
      if (
        message?.type !== 'cep-lifecycle-probe' ||
        message.version !== 1 ||
        typeof message.token !== 'string' ||
        !/^[a-f0-9]{32}$/.test(message.token)
      )
        return
      const root = document.getElementById('root')
      const visible = Array.from(root?.children ?? []).some((node) => {
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      bridge.postMessage({
        type: 'cep-lifecycle',
        documentId: window.__CEP_DOCUMENT_ID__,
        version: 1,
        token: message.token,
        mounted: true,
        visible,
        assetFault: window.__CEP_BOOT_FAULT__ === true,
      })
    }
    bridge.addEventListener('message', listener)
    return () => bridge.removeEventListener('message', listener)
  }, [])
  return children
}

declare global {
  interface Window {
    __CEP_BOOT_FAULT__?: boolean
    __CEP_INBOX_INTENT__?: string
  }
}

export class DesktopErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    // Do not send stack traces, component props or page text into native logs.
    window.__CEP_BOOT_FAULT__ = true
  }
  render() {
    return this.state.failed ? (
      <div role="alert">Não foi possível carregar a interface. Use Recarregar interface.</div>
    ) : (
      this.props.children
    )
  }
}
