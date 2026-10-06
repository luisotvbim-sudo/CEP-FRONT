import type { AuthClient, AuthError } from '../auth/auth-client'
import type { AdminApi } from '../admin/api'
import { date, duration, timestamp } from '../admin/format'
import { Loading, PageHeading } from '../admin/ui'
import { AnalysisDetails } from '../notifications/AnalysisDetails'
import { periodLabels } from '../notifications/api'
import { overviewApi, type OverviewPeriod, type OverviewStatus } from './overview-api'
import { useOverview } from './useOverview'
import { PersonalPeriodHistory } from './PersonalPeriodHistory'
import './overview.css'

const messages: Record<OverviewStatus, { title: string; detail: string }> = {
  regular: {
    title: 'Dentro da tolerância neste corte',
    detail: 'Os dias consultados têm valores conhecidos dentro da tolerância.',
  },
  difference: {
    title: 'Há diferenças para conferir',
    detail:
      'Revise os dias destacados e os registros nas fontes. Uma diferença não significa irregularidade.',
  },
  incomplete: {
    title: 'Ainda faltam informações',
    detail:
      'A conferência não pôde concluir todo o período. Os valores indisponíveis não significam zero horas.',
  },
  notAssociated: {
    title: 'Sua associação precisa ser conferida',
    detail: 'Peça ao coordenador para conferir a associação da sua conta ao Monday e ao VR Mais.',
  },
  inactiveIdentity: {
    title: 'Um cadastro de origem está inativo',
    detail:
      'Peça ao coordenador para revisar seus cadastros nas fontes antes de conferir novamente.',
  },
}

export function PersonalOverview({
  client,
  historyApi,
  personId,
  associationPending,
  associationError,
  retryAssociation,
  onHistory,
  onNotifications,
}: {
  client: AuthClient
  historyApi: AdminApi
  personId?: string | null
  associationPending: boolean
  associationError: AuthError | null
  retryAssociation(): void
  onHistory(): void
  onNotifications(): void
}) {
  const query = useOverview(overviewApi(client))
  const value = query.data?.period === query.period ? query.data : undefined
  const message = value && messages[value.status]
  const analysis = value?.analysis
  const selectedPeriod = value?.periods?.find((item) => item.period === query.period)
  return (
    <>
      <PageHeading
        eyebrow="ACOMPANHAMENTO PESSOAL"
        title="Minha jornada"
        description="Confira sua situação e os dias que merecem atenção."
      />
      <section
        className="admin-panel overview-panel"
        aria-label="Conferência pessoal"
        aria-busy={query.pending}
      >
        <div className="overview-controls">
          <div>
            <label htmlFor="overview-period">Período oficial</label>
            <select
              id="overview-period"
              value={query.period}
              disabled={!query.periods.length || !!query.retryAt}
              onChange={(event) => query.setPeriod(event.target.value as OverviewPeriod)}
            >
              {query.periods.length ? (
                query.periods.map((item) => (
                  <option key={item.period} value={item.period}>
                    {periodLabels[item.period!]}
                  </option>
                ))
              ) : (
                <option value="daily">Diário</option>
              )}
            </select>
          </div>
          <button
            className="secondary-button"
            disabled={query.pending || !!query.retryAt}
            onClick={query.reload}
          >
            Conferir agora
          </button>
        </div>
        {query.pending && (
          <Loading text="Conferindo suas fontes. Esta consulta pode levar alguns instantes…" />
        )}
        {query.error && (
          <div role="alert" className="overview-notice">
            <strong>
              {query.error.status === 404
                ? 'Esta versão da API ainda não oferece o acompanhamento pessoal.'
                : query.error.status === 429
                  ? 'Aguarde antes de conferir novamente.'
                  : 'Não foi possível concluir a conferência.'}
            </strong>
            <p>
              {query.error.status === 404
                ? 'Você pode continuar consultando seu histórico e seus avisos.'
                : query.error.status === 429
                  ? 'O serviço limitou as consultas. O botão será liberado após a espera indicada.'
                  : 'Tente novamente quando a conexão e as fontes estiverem disponíveis.'}
            </p>
            {value && (
              <p>O resultado abaixo é da conferência anterior, até {timestamp(value.cutoff)}.</p>
            )}
          </div>
        )}
        {value && message && (
          <>
            <div className={`overview-situation overview-${value.status}`}>
              <h2>{message.title}</h2>
              <p>{message.detail}</p>
              {analysis?.days?.some((day) => day.partial) && (
                <p>O dia em andamento é parcial: os valores podem mudar até seu fechamento.</p>
              )}
              <p className="muted">
                Conferido até {timestamp(value.cutoff)}
                {analysis && ` · ${date(analysis.from)} a ${date(analysis.to)}`}
              </p>
            </div>
            {analysis && (
              <>
                <dl className="overview-metrics">
                  <div>
                    <dt>Horas no VR Mais</dt>
                    <dd>{duration(analysis.vrSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Horas no Monday</dt>
                    <dd>{duration(analysis.mondaySeconds)}</dd>
                  </div>
                  <div>
                    <dt>Diferença Monday − VR</dt>
                    <dd>{duration(analysis.deltaSeconds)}</dd>
                  </div>
                </dl>
                <p className="muted">
                  Diferença negativa: menos horas no Monday. Positiva: mais horas no Monday. O saldo
                  não substitui a revisão de cada dia.
                </p>
                {value.attentionDays!.length > 0 && (
                  <section aria-label="Dias para conferir">
                    <h3>Dias que merecem atenção</h3>
                    <ul className="overview-attention">
                      {value.attentionDays!.map((day) => (
                        <li key={day.day}>
                          <strong>{date(day.day)}</strong> ·{' '}
                          {day.status === 'difference'
                            ? 'Diferença acima da tolerância'
                            : 'Informações insuficientes'}
                          {day.partial && ' · Dia parcial'}
                          <span>
                            Confira os registros de ponto e atividades na origem; se precisar,
                            procure o coordenador.
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <details className="overview-details">
                  <summary>Ver detalhes e qualidade das fontes</summary>
                  <AnalysisDetails value={analysis} />
                  {value.status === 'incomplete' && (
                    <>
                      <h3>Valores disponíveis por fonte</h3>
                      <p>
                        Leituras individuais no mesmo corte. Estes valores não substituem os totais
                        completos do período.
                      </p>
                      <div
                        className="table-scroll"
                        role="region"
                        aria-label="Valores por fonte"
                        tabIndex={0}
                      >
                        <table>
                          <thead>
                            <tr>
                              <th>Dia</th>
                              <th>VR Mais</th>
                              <th>Monday</th>
                            </tr>
                          </thead>
                          <tbody>
                            {value.availableSourceDays!.map((day) => (
                              <tr key={day.day}>
                                <td>{date(day.day)}</td>
                                <td>{duration(day.vrSeconds)}</td>
                                <td>{duration(day.mondaySeconds)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </details>
              </>
            )}
          </>
        )}
        <div className="overview-links">
          <button className="secondary-button" onClick={onHistory}>
            Consultar meu histórico
          </button>
          <button className="secondary-button" onClick={onNotifications}>
            Ver meus avisos
          </button>
        </div>
        <p className="muted">
          Conferir agora lê as fontes. Atualizar histórico importa registros. Relatórios e avisos
          anteriores conservam o corte original; ler um aviso não resolve uma ocorrência.
        </p>
      </section>
      {selectedPeriod?.from && selectedPeriod.to && (
        <PersonalPeriodHistory
          api={historyApi}
          personId={personId}
          associationPending={associationPending}
          associationError={associationError}
          retryAssociation={retryAssociation}
          from={selectedPeriod.from}
          to={selectedPeriod.to}
        />
      )}
    </>
  )
}
