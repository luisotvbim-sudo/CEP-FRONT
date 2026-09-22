import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Inbox, LoaderCircle, Search } from 'lucide-react'
import { errorMessage, type AuthError } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'

export function useQuery<T>(load: () => Promise<T>, keys: unknown[]) {
  const [state, setState] = useState<{ data?: T; pending: boolean; error: AuthError | null }>({
    pending: true,
    error: null,
  })
  const [version, setVersion] = useState(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    let active = true
    setState({ pending: true, error: null })
    loader.current().then(
      (data) => {
        if (active) setState({ data, pending: false, error: null })
      },
      (failure) => {
        if (active) setState({ pending: false, error: errorMessage(failure) })
      },
    )
    return () => {
      active = false
    }
    // Consumers supply explicit invalidation keys; the latest loader is read through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...keys, version])
  return { ...state, reload: () => setVersion((v) => v + 1) }
}
export function useAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const busy = useRef(false)
  async function run(action: () => Promise<void>) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return { pending, error, run, clear: () => setError(null) }
}
export function Loading({ text = 'Carregando dados…' }: { text?: string }) {
  return (
    <div className="admin-loading" role="status">
      <LoaderCircle size={19} className="spin" />
      {text}
    </div>
  )
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={28} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  )
}
export function QueryError({ error, retry }: { error: AuthError | null; retry(): void }) {
  return (
    <>
      <FormNotice error={error} />
      {error && (
        <button className="secondary-button" onClick={retry}>
          Tentar novamente
        </button>
      )}
    </>
  )
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
export function SearchBox({
  onSearch,
  placeholder = 'Pesquisar por nome ou e-mail',
  label = 'Pesquisar',
  initial = '',
}: {
  onSearch(value: string): void
  placeholder?: string
  label?: string
  initial?: string
}) {
  const [value, setValue] = useState(initial)
  const search = useRef(onSearch)
  const lastSearch = useRef(initial.trim())
  search.current = onSearch
  useEffect(() => {
    const query = value.trim()
    if (query === lastSearch.current) return
    const timer = setTimeout(() => {
      if (query === lastSearch.current) return
      lastSearch.current = query
      search.current(query)
    }, 300)
    return () => clearTimeout(timer)
  }, [value])
  return (
    <form
      className="admin-search"
      onSubmit={(e) => {
        e.preventDefault()
        const query = value.trim()
        if (query !== lastSearch.current) {
          lastSearch.current = query
          onSearch(query)
        }
      }}
    >
      <Search size={17} aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
    </form>
  )
}
export function Pagination({
  page,
  total,
  size,
  onPage,
  pending = false,
}: {
  page: number
  total: number
  size: number
  onPage(page: number): void
  pending?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <div className="pagination">
      <span>
        {total} resultado{total !== 1 ? 's' : ''} · Página {page} de {pages}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Página anterior"
          disabled={page <= 1 || pending}
          onClick={() => onPage(page - 1)}
        >
          <ArrowLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Próxima página"
          disabled={page >= pages || pending}
          onClick={() => onPage(page + 1)}
        >
          <ArrowRight size={17} />
        </button>
      </div>
    </div>
  )
}
export function PageHeading({
  eyebrow = 'ADMINISTRAÇÃO',
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="admin-page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}
