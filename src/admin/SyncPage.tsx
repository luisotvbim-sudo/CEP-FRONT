import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { AuthError, errorMessage } from '../auth/auth-client'
import type { AdminApi, Sync } from './api'
import { date, sourceLabel, syncLabels, timestamp } from './format'
import { Badge, Empty, Loading, PageHeading, QueryError } from './ui'
import { FormNotice } from '../components/FormNotice'

export function SyncPage({ api }: { api: AdminApi }) {
  const [batch, setBatch] = useState<Sync | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [full, setFull] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [pollError, setPollError] = useState<AuthError | null>(null)
  const active = useRef(true)
  const inFlight = useRef(false)
  const batchId = useRef<string | undefined>(undefined)
  const previousBatch = useRef<string | undefined>(undefined)
  const revision = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++revision.current
    try {
      const result = batchId.current ? await api.syncStatus(batchId.current) : await api.latest()
      if (current !== revision.current) return
      if (result.id && result.id === previousBatch.current) return
      if (active.current) {
        batchId.current = result.id
        setBatch(result)
        setPollError(null)
      }
    } catch (failure) {
      if (!active.current || current !== revision.current) return
      if (failure instanceof AuthError && failure.code === 'sync_not_found') {
        setBatch(null)
        setPollError(null)
      } else setPollError(errorMessage(failure))
    } finally {
      if (active.current && current === revision.current) setLoading(false)
    }
  }, [api])
  useEffect(() => {
    active.current = true
    void refresh()
    return () => {
      active.current = false
    }
  }, [refresh])
  const running = starting || batch?.status === 'running'
  useEffect(() => {
    if (!running) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refresh()
      if (!disposed) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 1200)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [running, refresh])

  async function start() {
    if (inFlight.current || running) return
    inFlight.current = true
    revision.current++
    setStarting(true)
    setError(null)
    previousBatch.current = batch?.id
    setBatch(null)
    batchId.current = undefined
    try {
      const result = await api.synchronize(full)
      revision.current++
      previousBatch.current = undefined
      if (active.current) {
        batchId.current = result.id
        setBatch(result)
      }
    } catch (failure) {
      revision.current++
      previousBatch.current = undefined
      if (active.current) {
        setError(errorMessage(failure))
        await refresh()
      }
    } finally {
      inFlight.current = false
      if (active.current) setStarting(false)
    }
  }

  return (
    <>
      <PageHeading
        title="Sincronização"
        description="Acompanhe a coleta de perfis e registros de horas de cada fonte."
        action={
          <button
            className="secondary-button"
            onClick={() => {
              batchId.current = undefined
              void refresh()
            }}
            disabled={loading}
          >
            <RefreshCw size={15} /> Consultar estado
          </button>
        }
      />
      <div className="admin-panel sync-control">
        <div>
          <h2>Atualizar dados das fontes</h2>
          <p>
            A coleta é feita pela API. Uma falha no Monday não descarta o resultado válido do VR
            Mais, e vice-versa.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={full}
              onChange={(e) => setFull(e.target.checked)}
              disabled={running}
            />
            <span>Reprocessar os últimos 60 dias</span>
          </label>
        </div>
        <button
          className="primary-button compact"
          disabled={running || loading}
          onClick={() => void start()}
        >
          <RefreshCw size={17} className={running ? 'spin' : ''} />
          {running ? 'Coleta em andamento…' : 'Iniciar sincronização'}
        </button>
      </div>
      <FormNotice error={error} />
      <QueryError error={pollError} retry={() => void refresh()} />
      {running && (
        <div className="inline-info" role="status">
          Consultando o andamento da coleta. O serviço não informa um percentual de progresso. Você
          pode acompanhar o estado abaixo.
        </div>
      )}
      {loading ? (
        <Loading />
      ) : !batch && !running && !pollError ? (
        <div className="admin-panel">
          <Empty title="Nenhuma sincronização registrada">
            <p>Inicie a coleta para verificar a disponibilidade das fontes e importar os perfis.</p>
          </Empty>
        </div>
      ) : (
        batch && (
          <>
            <div className="sync-summary">
              <Badge
                tone={
                  batch.status === 'succeeded'
                    ? 'good'
                    : batch.status === 'running'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {syncLabels[batch.status ?? ''] || batch.status || 'Estado indisponível'}
              </Badge>
              <span>Início: {timestamp(batch.startedAt)}</span>
              <span>
                Fim: {batch.completedAt ? timestamp(batch.completedAt) : 'Ainda não concluída'}
              </span>
            </div>
            <div className="two-columns">
              {(['monday', 'vrMais'] as const).map((source) => {
                const item = batch.sources?.find((s) => s.source === source)
                const disabled =
                  item?.errorCode === 'monday_not_configured' ||
                  item?.errorCode === 'vr_mais_not_configured'
                return (
                  <section className="admin-panel source-result" key={source}>
                    <div className="source-heading">
                      <h2>
                        <span className={`source-dot ${source}`} />
                        {sourceLabel(source)}
                      </h2>
                      <Badge
                        tone={
                          disabled ||
                          item?.status === 'failed' ||
                          item?.status === 'partiallySucceeded'
                            ? 'warning'
                            : item?.status === 'succeeded'
                              ? 'good'
                              : 'neutral'
                        }
                      >
                        {disabled
                          ? 'Integração desabilitada'
                          : syncLabels[item?.status ?? ''] || 'Sem resultado'}
                      </Badge>
                    </div>
                    {!item ? (
                      <p className="muted">
                        Esta fonte ainda não retornou um resultado neste lote.
                      </p>
                    ) : (
                      <>
                        {disabled ? (
                          <div className="inline-info">
                            A integração está desabilitada ou sem configuração no servidor. Solicite
                            a configuração ao responsável pela API.
                          </div>
                        ) : (
                          item.errorCode && (
                            <div className="inline-info">
                              {item.errorMessage || 'A fonte não concluiu a coleta.'}
                              <small>Código: {item.errorCode}</small>
                            </div>
                          )
                        )}
                        <dl className="source-metrics">
                          <div>
                            <dt>Perfis recebidos</dt>
                            <dd>{item.receivedCount ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>Registros recebidos</dt>
                            <dd>{item.timeRecordReceivedCount ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>Perfis criados / atualizados</dt>
                            <dd>
                              {item.createdCount ?? '—'} / {item.updatedCount ?? '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>Registros criados / atualizados</dt>
                            <dd>
                              {item.timeRecordCreatedCount ?? '—'} /{' '}
                              {item.timeRecordUpdatedCount ?? '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>Perfis desativados</dt>
                            <dd>{item.deactivatedCount ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>Registros removidos</dt>
                            <dd>{item.timeRecordRemovedCount ?? '—'}</dd>
                          </div>
                        </dl>
                        <div className="source-coverage">
                          <Database size={17} />
                          <div>
                            <strong>Cobertura dos registros</strong>
                            <p>
                              {item.coverageFrom && item.coverageTo
                                ? `${date(item.coverageFrom)} a ${date(item.coverageTo)}`
                                : 'Nenhuma cobertura informada'}
                            </p>
                            <small>
                              Diretório:{' '}
                              {item.completeSnapshot
                                ? 'retrato completo informado'
                                : 'retrato completo não confirmado'}
                            </small>
                          </div>
                        </div>
                        <p className="page-footnote">
                          Conclusão da tentativa: {timestamp(item.completedAt)}
                        </p>
                      </>
                    )}
                  </section>
                )
              })}
            </div>
            <p className="page-footnote">
              A data desta tentativa não equivale ao último sucesso de todas as fontes. Resultados
              parciais não confirmam cobertura completa.
            </p>
          </>
        )
      )}
    </>
  )
}
