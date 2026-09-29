import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bell,
  CalendarClock,
  ChartNoAxesCombined,
  ClipboardList,
  History,
  Send,
  Settings2,
} from 'lucide-react'
import logo from '../assets/conceito-logo.png'
import { Badge, Empty, Loading, PageHeading } from '../admin/ui'
import '../admin/admin.css'
import './analysis-preview.css'

// View models for an isolated design preview. These are not API contracts.
type Profile = 'coordinator' | 'leader' | 'member'
type Scenario =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'offline'
  | 'expired'
  | 'denied'
  | 'partial'
  | 'unlinked'
  | 'conflict'
type Period = 'daily' | 'weekly' | 'sprint'
const periods: Record<Period, string> = { daily: 'Diário', weekly: 'Semanal', sprint: 'Sprint' }
const periodHelp: Record<Period, string> = {
  daily: 'Dia atual até o instante do envio.',
  weekly: 'Segunda-feira atual até o instante do envio.',
  sprint: 'Dias 1 a 14 ou dia 15 ao último dia do mês, até o envio. Não há sobreposição no dia 15.',
}
// Fixed example supplied to the presentation. Never resolve official dates on the PC.
const examplePeriods: Record<Period, string> = {
  daily: '22/09/2026, 00h–11h50',
  weekly: '21/09/2026, 00h até 22/09/2026, 11h50',
  sprint: '15/09/2026, 00h até 22/09/2026, 11h50',
}
const pages = [
  { id: 'analysis', label: 'Minha análise', icon: ChartNoAxesCombined },
  { id: 'inbox', label: 'Notificações', icon: Bell },
  { id: 'occurrences', label: 'Relatórios de erros', icon: ClipboardList },
  { id: 'send', label: 'Enviar agora', icon: Send },
  { id: 'sends', label: 'Histórico de envios', icon: History },
  { id: 'schedules', label: 'Agendamentos', icon: CalendarClock },
  { id: 'settings', label: 'Configurações globais', icon: Settings2 },
] as const
type Page = (typeof pages)[number]['id']
const scenarios: [Scenario, string][] = [
  ['ready', 'Exemplo disponível'],
  ['loading', 'Carregamento'],
  ['empty', 'Sem resultados'],
  ['offline', 'Falha de conexão'],
  ['expired', 'Sessão expirada'],
  ['denied', 'Acesso negado'],
  ['partial', 'Fonte indisponível'],
  ['unlinked', 'Sem associação'],
  ['conflict', 'Edição concorrente'],
]

function Notice({ children }: { children: ReactNode }) {
  return <div className="preview-notice">{children}</div>
}
function Confirm({
  title,
  children,
  onCancel,
  onConfirm,
}: {
  title: string
  children: ReactNode
  onCancel(): void
  onConfirm(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="preview-dialog"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id="confirm-title">{title}</h2>
      {children}
      <div className="button-row">
        <button autoFocus className="secondary-button" onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary-button compact" onClick={onConfirm}>
          Confirmar na prévia
        </button>
      </div>
    </dialog>
  )
}
function PeriodPicker({ value, onChange }: { value: Period; onChange(value: Period): void }) {
  return (
    <fieldset className="preview-period">
      <legend>Período da análise</legend>
      <div className="button-row">
        {(Object.keys(periods) as Period[]).map((period) => (
          <label key={period}>
            <input
              type="radio"
              name="period"
              checked={value === period}
              onChange={() => onChange(period)}
            />
            {periods[period]}
          </label>
        ))}
      </div>
      <p>
        {periodHelp[value]} Horário de São Paulo; período oficial e corte serão definidos pelo
        servidor.
      </p>
    </fieldset>
  )
}
function Analysis({ partial = false }: { partial?: boolean }) {
  const [period, setPeriod] = useState<Period>('daily')
  return (
    <>
      <div className="admin-panel">
        <PeriodPicker value={period} onChange={setPeriod} />
        <p>
          <strong>Exemplo fixo:</strong> {examplePeriods[period]} · America/Sao_Paulo
        </p>
        <Badge tone="warning">Período em andamento · resultado provisório</Badge>
      </div>
      {period !== 'daily' ? (
        <div className="admin-panel">
          <Empty title="Resultado do período ainda indisponível">
            <p>
              A prévia ilustra um dia. Totais semanais e por sprint aguardam a análise centralizada;
              não são calculados neste navegador.
            </p>
          </Empty>
        </div>
      ) : (
        <>
          <div className="preview-metrics">
            {[
              [
                'VR Mais',
                partial ? '—' : '03h50',
                partial ? 'Fonte indisponível' : 'Inclui intervalo aberto até o corte',
              ],
              ['Monday', '03h20', 'Inclui sessão aberta até o mesmo corte'],
              [
                'Diferença',
                partial ? '—' : '−00h30',
                partial ? 'Não calculável' : '30 minutos a menos no Monday',
              ],
              ['Tolerância diária', '—', 'Valor inicial ainda não definido'],
            ].map(([label, value, help]) => (
              <section className="admin-panel" key={label}>
                <h2>{label}</h2>
                <strong className="preview-number">{value}</strong>
                <p>{help}</p>
              </section>
            ))}
          </div>
          <div className="admin-panel">
            <h2>Qualidade e atualização das fontes</h2>
            <p>
              Monday: exemplo atualizado às 11h49.{' '}
              {partial
                ? 'VR Mais: consulta falhou; último sucesso não informado.'
                : 'VR Mais: exemplo atualizado às 11h48.'}
            </p>
            <Notice>
              {partial
                ? 'Dados incompletos. Não é possível afirmar coerência nem tratar a ausência como zero.'
                : 'Sem uma tolerância aprovada, esta diferença não recebe classificação de gravidade.'}
            </Notice>
            <p>
              Versão da regra: indisponível nesta prévia. Os valores acima são exemplos de
              apresentação, não uma apuração real.
            </p>
          </div>
          <div className="admin-panel">
            <h2>Detalhe do dia · 22/09/2026</h2>
            <p>Ana Exemplo · pessoa fictícia</p>
            <details>
              <summary>Ver registros e evidências do exemplo</summary>
              <ul>
                <li>
                  VR Mais: entrada às 08h; intervalo ainda aberto no corte de 11h50. Situação
                  esperada durante o expediente.
                </li>
                <li>
                  Monday: atividade fictícia “Revisão de projeto”; início às 08h30, cronômetro
                  aberto até 11h50.
                </li>
              </ul>
              <p>
                Um intervalo aberto durante o expediente não é automaticamente erro. Cronômetros que
                atravessam o fechamento serão identificados separadamente.
              </p>
            </details>
          </div>
        </>
      )}
    </>
  )
}

function Settings({ conflict }: { conflict: boolean }) {
  const [tolerance, setTolerance] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [saved, setSaved] = useState(false)
  return (
    <div className="admin-panel">
      <h2>Regras compartilhadas</h2>
      <Notice>
        Alcance global: as configurações serão compartilhadas por todas as organizações. Isso não
        amplia o acesso a pessoas ou destinatários.
      </Notice>
      <form
        className="preview-form"
        onSubmit={(e) => {
          e.preventDefault()
          setConfirm(true)
        }}
      >
        <label>
          Tolerância diária (minutos)
          <input
            type="number"
            required
            min="0"
            step="1"
            value={tolerance}
            placeholder="Definir com o responsável"
            onChange={(e) => {
              setTolerance(e.target.value)
              setSaved(false)
            }}
          />
        </label>
        <label>
          Fuso de negócio
          <input readOnly value="America/Sao_Paulo" />
        </label>
        <p>
          Última alteração, autoria e versão: indisponíveis até a integração. A permissão efetiva
          será validada pelo servidor para todo administrador autorizado, inclusive Coordenador.
        </p>
        {conflict && (
          <p role="alert" className="preview-notice">
            Exemplo de conflito: outra pessoa alterou a configuração. Seu rascunho foi preservado;
            será necessário carregar a versão atual e revisar antes de salvar.
          </p>
        )}
        <button className="primary-button compact" disabled={conflict}>
          Revisar rascunho
        </button>
      </form>
      {saved && (
        <p role="status">
          Rascunho aplicado apenas nesta prévia. Nenhuma configuração foi salva no servidor.
        </p>
      )}
      {confirm && (
        <Confirm
          title="Revisar alteração global"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setSaved(true)
            setConfirm(false)
          }}
        >
          <p>Tolerância proposta: {tolerance} minutos por dia, para todas as organizações.</p>
          <p>
            Confirmação visual: não altera regras reais. Simetria e precisão ainda dependem de
            definição.
          </p>
        </Confirm>
      )}
    </div>
  )
}

type Schedule = { id: string; time: string; purpose: string; message: string; active: boolean }
const initialSchedules: Schedule[] = [
  {
    id: 'yesterday',
    time: '10:00',
    purpose: 'Pendências do dia anterior',
    message: 'Confira os ajustes do dia anterior.',
    active: false,
  },
  {
    id: 'lunch',
    time: '11:50',
    purpose: 'Conferência parcial / almoço',
    message: 'Confira suas horas e lembre-se de pausar perto do almoço.',
    active: false,
  },
  {
    id: 'evening',
    time: '17:00',
    purpose: 'Conferência parcial / fim do expediente',
    message: 'Confira os registros antes de encerrar o expediente.',
    active: false,
  },
]
function Schedules() {
  const [items, setItems] = useState(initialSchedules)
  const [draft, setDraft] = useState<Schedule | null>(null)
  const [removing, setRemoving] = useState<Schedule | null>(null)
  const [notice, setNotice] = useState('')
  return (
    <>
      <Notice>
        Propostas de agenda, sem disparos ativos. As mensagens são sugestões de redação. Avisos
        automáticos somente de segunda a sexta; processamento diário continua nos fins de semana.
      </Notice>
      <div className="admin-panel">
        <div className="panel-toolbar">
          <h2>Horários de São Paulo</h2>
          <button
            className="secondary-button"
            onClick={() =>
              setDraft({
                id: crypto.randomUUID(),
                time: '',
                purpose: '',
                message: '',
                active: false,
              })
            }
          >
            Criar agendamento
          </button>
        </div>
        <div className="preview-schedules">
          {items.map((item) => (
            <article key={item.id}>
              <div>
                <strong className="preview-time">{item.time}</strong>
                <h3>{item.purpose}</h3>
                <p>{item.message}</p>
                <Badge>{item.active ? 'Ativo somente na prévia' : 'Inativo na prévia'}</Badge>
              </div>
              <div className="button-row">
                <button
                  className="secondary-button"
                  onClick={() => setDraft({ ...item })}
                  aria-label={`Editar ${item.time}`}
                >
                  Editar
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setRemoving(item)}
                  aria-label={`Excluir ${item.time}`}
                >
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
        {!items.length && (
          <Empty title="Nenhuma proposta de agenda">
            <p>Crie um rascunho para revisar o fluxo.</p>
          </Empty>
        )}
        <p>
          Às 10h: somente o dia civil anterior. Segunda-feira considera domingo. Não acumulamos
          avisos automáticos do fim de semana.
        </p>
      </div>
      {draft && (
        <div className="admin-panel">
          <h2>Rascunho de agendamento</h2>
          <form
            className="preview-form"
            onSubmit={(e) => {
              e.preventDefault()
              setItems((current) =>
                current.some((item) => item.id === draft.id)
                  ? current.map((item) => (item.id === draft.id ? draft : item))
                  : [...current, draft],
              )
              setDraft(null)
              setNotice('Agenda alterada somente na prévia. Nenhum disparo foi programado.')
            }}
          >
            <label>
              Horário
              <input
                type="time"
                required
                value={draft.time}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })}
              />
            </label>
            <label>
              Finalidade da regra
              <select
                required
                value={draft.purpose}
                onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
              >
                <option value="">Selecione uma finalidade</option>
                {initialSchedules.map((item) => (
                  <option key={item.id}>{item.purpose}</option>
                ))}
              </select>
            </label>
            <label>
              Mensagem
              <textarea
                required
                maxLength={2000}
                value={draft.message}
                onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              />
            </label>
            <label className="preview-check">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              Ativo na prévia
            </label>
            <p>A finalidade define o comportamento; o texto da mensagem não muda o cálculo.</p>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => setDraft(null)}>
                Descartar rascunho
              </button>
              <button className="primary-button compact">Aplicar na prévia</button>
            </div>
          </form>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {removing && (
        <Confirm
          title="Excluir proposta de agenda?"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setItems((current) => current.filter((item) => item.id !== removing.id))
            if (draft?.id === removing.id) setDraft(null)
            setRemoving(null)
            setNotice('Proposta removida da prévia. Nenhum agendamento real foi excluído.')
          }}
        >
          <p>
            {removing.time} · {removing.purpose}
          </p>
          <p>
            Na operação real, a exclusão impedirá novos disparos e preservará histórico e auditoria.
          </p>
        </Confirm>
      )}
    </>
  )
}

function SendNow() {
  const [target, setTarget] = useState('one')
  const [message, setMessage] = useState('')
  const [period, setPeriod] = useState<Period>('daily')
  const [review, setReview] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  function invalidate() {
    setReview(false)
    setConfirmed(false)
  }
  return (
    <div className="admin-panel">
      <h2>Mensagem com análise individual</h2>
      <form
        className="preview-form"
        onSubmit={(e) => {
          e.preventDefault()
          setReview(true)
        }}
      >
        <label>
          Destinatários
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value)
              invalidate()
            }}
          >
            <option value="one">Um usuário</option>
            <option value="all">Todos do escopo autorizado</option>
          </select>
        </label>
        {target === 'one' && (
          <label>
            Usuário de demonstração
            <select>
              <option>Ana Exemplo · pessoa fictícia</option>
            </select>
          </label>
        )}
        <label>
          Mensagem
          <textarea
            required
            maxLength={2000}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value)
              invalidate()
            }}
            placeholder="Escreva a orientação que acompanha a análise."
          />
        </label>
        <PeriodPicker
          value={period}
          onChange={(value) => {
            setPeriod(value)
            invalidate()
          }}
        />
        <button className="primary-button compact" disabled={!message.trim()}>
          Revisar aviso de exemplo
        </button>
      </form>
      {review && (
        <section className="preview-review" aria-label="Prévia do aviso">
          <h3>Confira antes de enviar</h3>
          <p>
            <strong>Destinatários fictícios:</strong>{' '}
            {target === 'one' ? 'Ana Exemplo (1)' : 'Ana Exemplo e Bruno Exemplo (2)'}
          </p>
          <p>
            <strong>Período ilustrativo:</strong> {examplePeriods[period]}
          </p>
          <blockquote>{message}</blockquote>
          <p>
            Cada pessoa receberá sua própria análise. O servidor deverá revalidar destinatários,
            período e corte no envio.
          </p>
          <button
            className="primary-button compact"
            disabled={confirmed}
            onClick={() => setConfirmed(true)}
          >
            Confirmar somente a prévia
          </button>
          {confirmed && (
            <p role="status">
              Prévia confirmada. Nenhuma mensagem foi enfileirada, entregue ou enviada.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

const notifications = [
  {
    id: 'demo-1',
    title: 'Conferência parcial do expediente',
    date: '22/09/2026 às 11h50',
    delayed: true,
    text: 'Exemplo recebido após reconexão. Confira os registros referentes ao período original, não às horas atuais.',
  },
  {
    id: 'demo-2',
    title: 'Ajustes do dia anterior',
    date: '22/09/2026 às 10h',
    delayed: false,
    text: 'Exemplo: há um cronômetro que atravessou o fechamento de 21/09. Confira o registro na origem.',
  },
]
function Inbox() {
  const [filter, setFilter] = useState('unread')
  const [read, setRead] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const visible = notifications.filter((item) => filter === 'all' || !read.includes(item.id))
  const detail = notifications.find((item) => item.id === selected)
  return (
    <>
      <div className="admin-panel">
        <div className="panel-toolbar">
          <h2>Caixa pessoal · Ana Exemplo</h2>
          <label>
            Exibir
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setSelected(null)
              }}
            >
              <option value="unread">Não lidas</option>
              <option value="all">Histórico completo</option>
            </select>
          </label>
        </div>
        <p>Receber um aviso não marca leitura. A leitura não resolve a ocorrência.</p>
        {visible.map((item) => (
          <button
            key={item.id}
            className="preview-inbox-item"
            aria-pressed={selected === item.id}
            onClick={() => setSelected(item.id)}
          >
            <span>
              <strong>{item.title}</strong>
              <small>{item.date} · São Paulo</small>
            </span>
            <Badge>{read.includes(item.id) ? 'Lida na prévia' : 'Não lida'}</Badge>
          </button>
        ))}
        {!visible.length && (
          <Empty title="Nenhuma notificação não lida no exemplo">
            <p>Os avisos continuam no histórico da prévia.</p>
          </Empty>
        )}
      </div>
      {detail && (
        <section className="admin-panel">
          <h2>{detail.title}</h2>
          <p>Gerada em {detail.date} · destinatária fictícia: Ana Exemplo</p>
          {detail.delayed && (
            <Notice>
              Aviso atrasado. Preserve o horário e a análise originais; não representa uma nova
              conferência.
            </Notice>
          )}
          <p>{detail.text}</p>
          <details>
            <summary>Análise anexada ao aviso</summary>
            <p>
              {detail.id === 'demo-1'
                ? 'Corte original: 22/09/2026 às 11h50. VR: 03h50; Monday: 03h20; diferença: −00h30. Exemplo provisório, sem classificação por tolerância.'
                : 'Dia original: 21/09/2026. Ocorrência de exemplo: cronômetro Monday aberto na virada do dia. Total conciliado indisponível.'}
            </p>
          </details>
          <button
            className="secondary-button"
            disabled={read.includes(detail.id)}
            onClick={() => setRead((current) => [...current, detail.id])}
          >
            Marcar como lida na prévia
          </button>
        </section>
      )}
    </>
  )
}

function Occurrences() {
  const [type, setType] = useState('all')
  const [person, setPerson] = useState('')
  const [day, setDay] = useState('2026-09-21')
  const rows = [
    [
      'punch',
      'Batidas ímpares no fechamento',
      'Sequência VR a conferir na origem; sem inferir direção de batida ambígua.',
    ],
    ['timer', 'Cronômetro aberto no fechamento', 'Monday ainda em execução na virada do dia.'],
  ].filter(
    ([kind]) =>
      (type === 'all' || kind === type) &&
      'ana exemplo'.includes(person.trim().toLowerCase()) &&
      (!day || day === '2026-09-21'),
  )
  return (
    <div className="admin-panel">
      <h2>Ocorrências no escopo autorizado</h2>
      <div className="preview-filters">
        <label>
          Dia
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label>
          Pessoa
          <input
            type="search"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="Pesquisar no exemplo"
          />
        </label>
        <label>
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">Todos</option>
            <option value="punch">Batidas ímpares</option>
            <option value="timer">Cronômetro no fechamento</option>
            <option value="difference">Diferença confirmada</option>
          </select>
        </label>
      </div>
      {rows.map(([kind, title, evidence]) => (
        <article className="preview-occurrence" key={kind}>
          <h3>{title}</h3>
          <p>Ana Exemplo · 21/09/2026 · pessoa fictícia</p>
          <Badge tone="warning">Aguardando conferência · exemplo</Badge>
          <details>
            <summary>Evidências e revisões</summary>
            <p>{evidence}</p>
            <p>
              Revisão ilustrativa 1. Uma correção deve gerar nova revisão, preservando esta
              ocorrência.
            </p>
          </details>
        </article>
      ))}
      {!rows.length && (
        <Empty title="Nenhuma ocorrência neste exemplo">
          <p>Ajuste os filtros. Isso não comprova ausência de erros nos dados reais.</p>
        </Empty>
      )}
      <p>
        Diferenças confirmadas dependem de qualidade suficiente e tolerância aprovada. O
        processamento da virada continua todos os dias; os avisos automáticos não são acumulados no
        fim de semana.
      </p>
    </div>
  )
}
function SendHistory() {
  const [filter, setFilter] = useState('all')
  const [retry, setRetry] = useState(false)
  const rows = [
    ['Ana Exemplo', 'Entregue ao cliente', 'Não lida'],
    ['Bruno Exemplo', retry ? 'Enfileirada' : 'Falha de entrega', 'Não lida'],
  ]
  return (
    <div className="admin-panel">
      <h2>Operação demonstrativa · sucesso parcial</h2>
      <p>
        Autoria: Coordenador de exemplo · 22/09/2026 às 11h50 · período diário · 2 destinatários
        fictícios
      </p>
      <label>
        Estado da entrega
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todos</option>
          <option value="failed">Somente falhas</option>
        </select>
      </label>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Resultados por destinatário"
      >
        <table>
          <caption>Resultados fictícios por destinatário</caption>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Entrega</th>
              <th>Leitura</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => filter === 'all' || row[1] === 'Falha de entrega')
              .map(([name, status, read]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{status}</td>
                  <td>{read}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {filter === 'failed' && retry && (
        <p>Nenhuma falha restante no exemplo; a nova tentativa está apenas enfileirada.</p>
      )}
      <p>
        Enfileirada, entregue ao cliente e lida são etapas distintas. A entrega não confirma
        leitura.
      </p>
      <button className="secondary-button" disabled={retry} onClick={() => setRetry(true)}>
        Simular nova tentativa apenas da falha
      </button>
      {retry && (
        <p role="status">
          Somente Bruno foi reenfileirado no exemplo. Ana não foi incluída novamente. Nenhum envio
          real ocorreu.
        </p>
      )}
    </div>
  )
}

export function AnalysisPreview() {
  const [profile, setProfile] = useState<Profile>('coordinator')
  const [page, setPage] = useState<Page>('analysis')
  const [scenario, setScenario] = useState<Scenario>('ready')
  const [revision, setRevision] = useState(0)
  const allowed = pages.filter(
    (item) =>
      profile === 'coordinator' ||
      ['analysis', 'inbox'].includes(item.id) ||
      (profile === 'leader' && item.id === 'occurrences'),
  )
  const active = allowed.find((item) => item.id === page) ?? allowed[0]
  useEffect(() => {
    document.title = 'Prévia de análises e avisos · CEP Horas'
  }, [])
  function reset() {
    setScenario('ready')
    setRevision((value) => value + 1)
  }
  const blocked = ['offline', 'expired', 'denied', 'unlinked', 'empty'].includes(scenario)
  const messages = {
    offline: [
      'Sem conexão no exemplo',
      'Seus rascunhos reais não foram enviados. Na integração, confira o resultado antes de repetir uma gravação.',
    ],
    expired: [
      'Sessão expirada no exemplo',
      'Na aplicação integrada, entre novamente para recuperar suas notificações pendentes.',
    ],
    denied: [
      'Acesso negado no exemplo',
      'O servidor deve validar sua permissão e o escopo a cada operação.',
    ],
    unlinked: [
      'Pessoa sem associação no exemplo',
      'Peça ao coordenador para conferir as identidades Monday/VR e os vínculos vigentes. Isso não significa zero horas.',
    ],
    empty: [
      'Sem resultados no exemplo',
      'Nenhum dado fictício neste cenário. As informações reais ainda não foram consultadas.',
    ],
  }
  return (
    <div className="admin-app analysis-preview">
      <aside className="admin-sidebar">
        <img src={logo} alt="Conceito Engenharia" />
        <div className="admin-product">
          <span className="product-mark">C</span>
          <div>
            <strong>CEP Horas</strong>
            <span>Análises e avisos · prévia</span>
          </div>
        </div>
        <nav aria-label="Telas de análises e avisos">
          {allowed.map((item) => (
            <button
              key={item.id}
              aria-current={active.id === item.id ? 'page' : undefined}
              onClick={() => {
                setPage(item.id)
                reset()
              }}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          Ambiente de revisão visual. Nenhum dado de cliente ou envio real.
        </div>
      </aside>
      <div className="admin-main">
        <header className="preview-banner">
          <strong>PRÉVIA LOCAL · DADOS FICTÍCIOS</strong>
          <span>
            Sem conexão com a API. Alterações duram somente nesta prévia e são descartadas ao trocar
            de tela ou recarregar.
          </span>
          <a href="/">Voltar ao login real</a>
        </header>
        <div className="preview-controls">
          <label>
            Perfil de demonstração
            <select
              value={profile}
              onChange={(e) => {
                setProfile(e.target.value as Profile)
                setPage('analysis')
                reset()
              }}
            >
              <option value="coordinator">Coordenador</option>
              <option value="leader">Líder</option>
              <option value="member">Membro</option>
            </select>
          </label>
          <label>
            Cenário de demonstração
            <select value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}>
              {scenarios.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" onClick={reset}>
            Reiniciar exemplo
          </button>
        </div>
        <main className="admin-content">
          <PageHeading
            eyebrow="PRÉVIA DO CONTRATO · 29/09/2026"
            title={active.label}
            description="Revise a experiência antes da integração. A operação real depende dos contratos de análise e notificações do backend."
          />
          {scenario === 'loading' ? (
            <Loading text="Exemplo de carregamento. Troque o cenário para continuar." />
          ) : blocked ? (
            <div className="admin-panel">
              <Empty title={messages[scenario as keyof typeof messages][0]}>
                <p>{messages[scenario as keyof typeof messages][1]}</p>
                <p>Referência fictícia para suporte: DEMO-SEM-API</p>
                <button className="secondary-button" onClick={reset}>
                  Voltar ao exemplo disponível
                </button>
              </Empty>
            </div>
          ) : (
            <div key={`${profile}-${active.id}-${revision}`}>
              {active.id === 'analysis' && <Analysis partial={scenario === 'partial'} />}
              {active.id === 'settings' && <Settings conflict={scenario === 'conflict'} />}
              {active.id === 'schedules' && <Schedules />}
              {active.id === 'send' && <SendNow />}
              {active.id === 'inbox' && <Inbox />}
              {active.id === 'occurrences' && <Occurrences />}
              {active.id === 'sends' && <SendHistory />}
            </div>
          )}
        </main>
        <footer className="admin-footer">
          Prévia de interface · Nenhum endpoint novo implementado · America/Sao_Paulo
        </footer>
      </div>
    </div>
  )
}
