import { useSynchronization } from './useSynchronization'
import { Database, RefreshCw } from 'lucide-react'
import type { AdminApi } from './api'
import { date, sourceLabel, syncLabels, timestamp } from './format'
import { Badge, Empty, Loading, PageHeading, QueryError } from './ui'
import { FormNotice } from '../components/FormNotice'

const sourceAdvice: Record<string, string> = {
  monday_responsible_column_unavailable: 'Peça ao coordenador para revisar a coluna de responsável configurada no Monday.',
  monday_multiple_responsibles: 'Há item com vários responsáveis. Corrija a atribuição na origem antes de atualizar novamente.',
  monday_invalid_configuration: 'Peça ao coordenador para revisar a configuração do Monday no servidor.',
}

export function SyncPage({ api, allowFull = true, embedded = false, onCompleted }: {
  api: AdminApi
  allowFull?: boolean
  embedded?: boolean
  onCompleted?: () => void
}) {
  const { batch, loading, full, setFull, error, pollError, running, refresh, start, reloadLatest } =
    useSynchronization(api, allowFull, onCompleted)

  if (embedded) {
    const statusFor = (source: 'monday' | 'vrMais') => {
      const item = batch?.sources?.find((entry) => entry.source === source)
      const label = sourceLabel(source)
      if (!item) return `${label}: sem resultado`
      if (item.errorCode === 'monday_not_configured' || item.errorCode === 'vr_mais_not_configured') return `${label}: integração desabilitada`
      return `${label}: ${syncLabels[item.status ?? ''] || 'Sem resultado'}`
    }
    const message = running
      ? 'Reprocessando dados…'
      : batch ? `${statusFor('monday')} · ${statusFor('vrMais')}` : null
    return (
      <>
        <button
          className="primary-button compact"
          disabled={running || loading}
          aria-describedby="history-reprocess-help"
          onClick={() => void start()}
        >
          <RefreshCw size={17} aria-hidden="true" className={running ? 'spin' : ''} />
          {running ? 'Reprocessando dados…' : 'Revalidar Monday e VR Mais (20 dias)'}
        </button>
        <p id="history-reprocess-help" className="muted">
          Revalida os últimos 20 dias inclusivos das duas fontes. Confira o resultado de Monday e VR Mais abaixo.
        </p>
        <FormNotice error={error} />
        <QueryError error={pollError} retry={() => void refresh()} />
        {message && <p role="status">{message}</p>}
      </>
    )
  }

  return (
    <>
      <PageHeading
        title="Sincronização"
        description="Acompanhe a coleta de perfis e registros de horas de cada fonte."
        action={
          <button
            className="secondary-button"
            onClick={reloadLatest}
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
          {allowFull ? (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={full}
                onChange={(e) => setFull(e.target.checked)}
                disabled={running}
              />
              <span>Reprocessar até 90 dias e diretórios (carga administrativa)</span>
            </label>
          ) : null}
          {(!allowFull || !full) && <p className="muted">Atualiza Monday e VR Mais nos últimos 20 dias inclusivos, incluindo hoje.</p>}
        </div>
        <button
          className="primary-button compact"
          disabled={running || loading}
          onClick={() => void start()}
        >
          <RefreshCw size={17} className={running ? 'spin' : ''} />
          {running ? 'Coleta em andamento…' : allowFull && full ? 'Reprocessar até 90 dias' : 'Atualizar últimos 20 dias'}
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
          <Empty title={error?.code === 'sync_already_running' ? 'Outra atualização está em andamento' : 'Nenhuma sincronização registrada'}>
            <p>{error?.code === 'sync_already_running'
              ? 'Aguarde e tente novamente. Seu histórico anterior não foi atualizado por esta tentativa.'
              : 'Inicie a coleta para verificar a disponibilidade das fontes e importar os perfis.'}</p>
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
                              {item.errorCode && sourceAdvice[item.errorCode] && <p>{sourceAdvice[item.errorCode]}</p>}
                              <small>Código: {item.errorCode}</small>
                            </div>
                          )
                        )}
                        <dl className="source-metrics">
                          <div>
                            <dt>Perfis recebidos nesta tentativa</dt>
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
                              Retrato do escopo processado:{' '}
                              {item.completeSnapshot
                                ? 'completo nesta tentativa'
                                : 'não confirmado'}
                            </small>
                          </div>
                        </div>
                        {item.receivedCount === 0 && (
                          <p className="page-footnote">
                            Zero perfis recebidos não confirma diretório vazio: ele pode não ter sido consultado nesta tentativa.
                          </p>
                        )}
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
