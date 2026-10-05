export type BridgeFailure = {
  status?: number
  code?: string
  correlationId?: string
  transportFailure?: boolean
  requestId?: string
}
type BridgeEvent = {
  data: { id?: string; ok?: boolean; result?: unknown; error?: BridgeFailure }
}
export type WebViewBridge = {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: BridgeEvent) => void): void
  removeEventListener(type: 'message', listener: (event: BridgeEvent) => void): void
}

declare global {
  interface Window {
    __CEP_DOCUMENT_ID__?: string
  }
}

export class BridgeCallFailure extends Error {
  constructor(
    readonly kind: 'timeout' | 'unavailable' | 'invalid' | 'reply',
    readonly failure: BridgeFailure = {},
  ) {
    super(kind)
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function validFailure(value: unknown): value is BridgeFailure {
  return (
    object(value) &&
    (value.status === undefined ||
      (typeof value.status === 'number' &&
        Number.isInteger(value.status) &&
        value.status >= 0 &&
        value.status <= 599)) &&
    (value.code === undefined || (typeof value.code === 'string' && value.code.length <= 100)) &&
    (value.correlationId === undefined ||
      value.correlationId === null ||
      (typeof value.correlationId === 'string' && value.correlationId.length <= 200)) &&
    (value.transportFailure === undefined || typeof value.transportFailure === 'boolean') &&
    (value.requestId === undefined ||
      value.requestId === null ||
      (typeof value.requestId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)))
  )
}

type PendingCall = {
  timer: ReturnType<typeof setTimeout>
  resolve(value: unknown): void
  reject(error: BridgeCallFailure): void
}

class BridgeTransport {
  private pending = new Map<string, PendingCall>()
  private listening = false
  constructor(private readonly bridge: WebViewBridge) {}

  private detachIfIdle() {
    if (this.pending.size || !this.listening) return
    this.listening = false
    try {
      this.bridge.removeEventListener('message', this.listener)
    } catch {
      /* Host may already be detached. */
    }
  }
  private take(id: string) {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    this.detachIfIdle()
    return pending
  }
  private listener: Parameters<WebViewBridge['addEventListener']>[1] = (event) => {
    if (!object(event.data) || typeof event.data.id !== 'string') return
    const pending = this.take(event.data.id)
    if (!pending) return
    if (event.data.ok === true && event.data.error === undefined) pending.resolve(event.data.result)
    else if (event.data.ok === false && validFailure(event.data.error))
      pending.reject(new BridgeCallFailure('reply', event.data.error))
    else pending.reject(new BridgeCallFailure('invalid'))
  }

  call<T>(
    type: 'cep-auth' | 'cep-power',
    operation: string,
    payload: object,
    timeout: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID()
      const documentId = typeof window === 'undefined' ? undefined : window.__CEP_DOCUMENT_ID__
      const timer = setTimeout(() => {
        this.take(id)?.reject(new BridgeCallFailure('timeout'))
      }, timeout)
      this.pending.set(id, { timer, resolve: (value) => resolve(value as T), reject })
      try {
        if (!this.listening) {
          this.bridge.addEventListener('message', this.listener)
          this.listening = true
        }
        this.bridge.postMessage({ id, type, operation, payload, documentId })
      } catch {
        this.take(id)?.reject(new BridgeCallFailure('unavailable'))
      }
    })
  }

  dispose() {
    for (const id of [...this.pending.keys()])
      this.take(id)?.reject(new BridgeCallFailure('unavailable'))
  }
}

const transports = new WeakMap<WebViewBridge, BridgeTransport>()

// Auth and power share one listener per bridge, with independently bounded calls.
// Adapters own domain validation/error policy; this transport never replays calls.
export function callBridge<T>(
  bridge: WebViewBridge,
  type: 'cep-auth' | 'cep-power',
  operation: string,
  payload: object,
  timeout: number,
): Promise<T> {
  let transport = transports.get(bridge)
  if (!transport) {
    transport = new BridgeTransport(bridge)
    transports.set(bridge, transport)
  }
  return transport.call<T>(type, operation, payload, timeout)
}

export function disposeBridge(bridge: WebViewBridge) {
  transports.get(bridge)?.dispose()
  transports.delete(bridge)
}
