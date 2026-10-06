import { useEffect, useRef } from 'react'
import { Bell, X } from 'lucide-react'
import { useQuery } from '../hooks/async'
import type { NotificationApi } from './api'
import { Inbox } from './Inbox'

export function NotificationBell({
  api,
  open,
  onOpen,
  onClose,
  onAll,
  revision,
}: {
  api: NotificationApi
  open: boolean
  onOpen(): void
  onClose(): void
  onAll(): void
  revision: number
}) {
  const unread = useQuery(() => api.inbox(1, true), [api, revision])
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = setInterval(unread.reload, 60_000)
    return () => clearInterval(timer)
  }, [unread.reload])
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onClose()
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        button.current?.focus()
      }
    }
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onClose()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keyboard)
    document.addEventListener('focusin', focus)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keyboard)
      document.removeEventListener('focusin', focus)
    }
  }, [open, onClose])
  const count = unread.data?.total
  return (
    <div className="notification-bell" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-button notification-trigger"
        aria-label="Minhas notificações"
        title="Minhas notificações"
        aria-expanded={open}
        aria-controls="personal-notifications-dropdown"
        onClick={() => {
          if (open) onClose()
          else {
            unread.reload()
            onOpen()
          }
        }}
      >
        <Bell size={21} />
        {count !== undefined && count > 0 && (
          <span className="notification-badge">{count > 99 ? '99+' : count}</span>
        )}
      </button>
      <span className="sr-only" role="status">
        {unread.error
          ? 'Contagem de notificações indisponível'
          : count !== undefined
            ? `${count} notificações não lidas`
            : 'Consultando notificações'}
      </span>
      {open && (
        <div
          id="personal-notifications-dropdown"
          className="notification-dropdown"
          role="region"
          aria-label="Minhas notificações"
          tabIndex={-1}
          ref={panel}
        >
          <div className="notification-dropdown-heading">
            <h2>Minhas notificações</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar notificações"
              onClick={() => {
                onClose()
                button.current?.focus()
              }}
            >
              <X size={18} />
            </button>
          </div>
          <Inbox api={api} compact onRead={unread.reload} />
          <button type="button" className="secondary-button notification-all" onClick={onAll}>
            Ver todas as notificações
          </button>
        </div>
      )}
    </div>
  )
}
