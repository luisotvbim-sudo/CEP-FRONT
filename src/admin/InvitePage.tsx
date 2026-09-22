import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Link2 } from 'lucide-react'
import type { AdminApi, Identity, Source } from './api'
import { sourceLabel, timestamp } from './format'
import {
  Empty,
  Loading,
  PageHeading,
  Pagination,
  QueryError,
  SearchBox,
  useAction,
  useQuery,
} from './ui'
import { FormNotice } from '../components/FormNotice'
import { errorMessage, type AuthError } from '../auth/auth-client'

const normalizedEmail = (value?: string | null) => value?.trim().toLowerCase() || ''

function IdentityPicker({
  api,
  source,
  selected,
  onSelect,
}: {
  api: AdminApi
  source: Source
  selected: Identity | null
  onSelect(value: Identity): void
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const list = useQuery(() => api.identities(source, search, page), [api, source, search, page])
  return (
    <section className="admin-panel identity-picker" aria-label={`Perfis ${sourceLabel(source)}`}>
      <h2>
        <span className={`source-dot ${source}`} />
        {sourceLabel(source)}
      </h2>
      <p className="muted">Perfis ativos, ainda não associados.</p>
      {selected && !list.data?.items?.some((item) => item.id === selected.id) && (
        <div className="identity-option selected">
          <Check size={17} aria-hidden="true" />
          <span>
            <small>Perfil selecionado fora desta página de resultados</small>
            <strong>{selected.displayName || 'Nome indisponível'}</strong>
            <small>
              {selected.email || 'Sem e-mail'} · ID externo {selected.externalId || '—'}
            </small>
          </span>
        </div>
      )}
      <SearchBox
        label={`Buscar perfil ${sourceLabel(source)}`}
        placeholder="Nome, e-mail ou ID externo"
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
      />
      <QueryError error={list.error} retry={list.reload} />
      {list.pending ? (
        <Loading />
      ) : (
        !list.error &&
        (!list.data?.items?.length ? (
          <Empty title="Nenhum perfil disponível">
            <p>Confira a sincronização e as configurações desta fonte, ou tente outra busca.</p>
          </Empty>
        ) : (
          <div className="identity-options">
            {list.data.items.map((identity, index) => (
              <label
                className={`identity-option ${selected?.id === identity.id ? 'selected' : ''}`}
                key={identity.id ?? index}
              >
                <input
                  type="radio"
                  name={`identity-${source}`}
                  checked={!!identity.id && selected?.id === identity.id}
                  disabled={
                    !identity.id || identity.isActive !== true || !!identity.workforcePersonId
                  }
                  onChange={() => onSelect(identity)}
                />
                <span>
                  <strong>{identity.displayName || 'Nome indisponível'}</strong>
                  <small>
                    {identity.email || 'Sem e-mail'} · ID externo {identity.externalId || '—'}
                  </small>
                </span>
              </label>
            ))}
          </div>
        ))
      )}
      {list.data && (
        <Pagination page={page} total={list.data.total ?? 0} size={8} onPage={setPage} />
      )}
    </section>
  )
}

export function InvitePage({
  api,
  onPeople,
  onSync,
}: {
  api: AdminApi
  onPeople(): void
  onSync(): void
}) {
  const [monday, setMonday] = useState<Identity | null>(null)
  const [vr, setVr] = useState<Identity | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const action = useAction()
  const [matching, setMatching] = useState(false)
  const [matchNotice, setMatchNotice] = useState('')
  const [matchError, setMatchError] = useState<AuthError | null>(null)
  const lookupVersion = useRef(0)
  const suggestedSource = useRef<Source | null>(null)
  useEffect(
    () => () => {
      lookupVersion.current++
    },
    [],
  )

  async function selectIdentity(source: Source, value: Identity) {
    const version = ++lookupVersion.current
    const current = source === 'monday' ? monday : vr
    const other = source === 'monday' ? vr : monday
    const otherSource: Source = source === 'monday' ? 'vrMais' : 'monday'
    const setOther = source === 'monday' ? setVr : setMonday
    const manualPair = !!other && (!current || suggestedSource.current === source)
    if (source === 'monday') setMonday(value)
    else setVr(value)
    setName(value.displayName || '')
    setEmail(value.email || '')
    setConfirmed(false)
    action.clear()
    setMatchError(null)
    setMatching(false)
    suggestedSource.current = null
    if (manualPair) {
      setMatchNotice('Correspondência escolhida manualmente. Confira os perfis antes de confirmar.')
      return
    }
    // Changing the person must not retain the previously suggested counterpart.
    setOther(null)
    const address = normalizedEmail(value.email)
    if (!address) {
      setMatchNotice(
        `Este perfil não possui e-mail. Selecione o perfil correspondente no ${sourceLabel(otherSource)}.`,
      )
      return
    }
    setMatching(true)
    setMatchNotice(`Buscando o mesmo e-mail no ${sourceLabel(otherSource)}…`)
    try {
      const result = await api.identities(otherSource, address)
      if (version !== lookupVersion.current) return
      const items = result.items || []
      const matches = items.filter(
        (item) =>
          item.id &&
          item.source === otherSource &&
          item.isActive === true &&
          !item.workforcePersonId &&
          normalizedEmail(item.email) === address,
      )
      // Search is partial and paginated. Never treat an incomplete page as a unique match.
      const complete = typeof result.total === 'number' && result.total <= items.length
      if (complete && matches.length === 1) {
        setOther(matches[0])
        suggestedSource.current = otherSource
        setMatchNotice(
          `Perfil do ${sourceLabel(otherSource)} pré-selecionado pelo mesmo e-mail. Confira se pertence à mesma pessoa antes de confirmar.`,
        )
      } else {
        setMatchNotice(
          !complete || matches.length > 1
            ? `Há mais de um resultado possível no ${sourceLabel(otherSource)}. Pesquise e selecione o perfil manualmente.`
            : `Nenhum perfil disponível com o mesmo e-mail no ${sourceLabel(otherSource)}. Os endereços podem ser diferentes; pesquise pelo nome e selecione manualmente.`,
        )
      }
    } catch (failure) {
      if (version !== lookupVersion.current) return
      setMatchError(errorMessage(failure))
      setMatchNotice(
        'Não foi possível buscar a correspondência. Você pode selecionar os dois perfis manualmente.',
      )
    } finally {
      if (version === lookupVersion.current) setMatching(false)
    }
  }

  function changeEmail(value: string) {
    setEmail(value)
    setConfirmed(false)
    action.clear()
    const address = normalizedEmail(value)
    // Editing the recipient does not change the linked IDs or invent a person's name.
    const known = address
      ? [monday, vr].find((item) => normalizedEmail(item?.email) === address)
      : null
    if (known?.displayName) setName(known.displayName)
  }
  const differentProfiles =
    monday &&
    vr &&
    ((!!monday.displayName &&
      !!vr.displayName &&
      monday.displayName.localeCompare(vr.displayName, 'pt-BR', { sensitivity: 'base' }) !== 0) ||
      (!!monday.email && !!vr.email && monday.email.toLowerCase() !== vr.email.toLowerCase()))
  if (success)
    return (
      <>
        <PageHeading
          title="Convite criado"
          description="A correspondência foi salva e o e-mail foi colocado na fila de envio."
        />
        <div className="admin-panel invitation-success">
          <Check size={32} />
          <h2>{name}</h2>
          <p>{email}</p>
          <p>Perfil de acesso: Usuário. Validade: {success} (São Paulo).</p>
          <button className="primary-button compact" onClick={onPeople}>
            Ver pessoas <ArrowRight size={17} />
          </button>
        </div>
      </>
    )
  return (
    <>
      <PageHeading
        title="Associar e convidar"
        description="Escolha os dois perfis, confira a correspondência e envie o convite de acesso."
        action={
          <button className="secondary-button" onClick={onSync}>
            Ver sincronização
          </button>
        }
      />
      <div className="inline-info">
        <Link2 size={19} />
        <span>
          Nomes semelhantes não garantem uma correspondência. Confira os dados dos dois perfis antes
          de confirmar.
        </span>
      </div>
      <fieldset className="unframed" disabled={action.pending}>
        <div className="two-columns">
          <IdentityPicker
            api={api}
            source="monday"
            selected={monday}
            onSelect={(value) => void selectIdentity('monday', value)}
          />
          <IdentityPicker
            api={api}
            source="vrMais"
            selected={vr}
            onSelect={(value) => void selectIdentity('vrMais', value)}
          />
        </div>
        <form
          className="admin-panel invite-confirmation"
          onSubmit={(e) => {
            e.preventDefault()
            if (!monday?.id || !vr?.id || !confirmed || matching) return
            void action.run(async () => {
              const result = await api.invite({
                displayName: name.trim(),
                email: email.trim(),
                mondayIdentityId: monday.id!,
                vrMaisIdentityId: vr.id!,
              })
              setSuccess(timestamp(result.invitation?.expiresAt))
            })
          }}
        >
          <h2>Confirme a pessoa e o convite</h2>
          {matchNotice && (
            <p className="inline-info" role="status">
              {matchNotice}
            </p>
          )}
          <FormNotice error={matchError} />
          <div className="selected-profiles">
            <div>
              <span>Monday selecionado</span>
              <strong>{monday?.displayName || 'Selecione um perfil acima'}</strong>
              <small>
                {monday?.email} {monday?.externalId ? `· ID ${monday.externalId}` : ''}
              </small>
            </div>
            <Link2 size={19} />
            <div>
              <span>VR Mais selecionado</span>
              <strong>{vr?.displayName || 'Selecione um perfil acima'}</strong>
              <small>
                {vr?.email} {vr?.externalId ? `· ID ${vr.externalId}` : ''}
              </small>
            </div>
          </div>
          <div className="form-grid">
            <div>
              <label htmlFor="invite-name">Nome da pessoa</label>
              <input
                id="invite-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setConfirmed(false)
                  action.clear()
                }}
              />
            </div>
            <div>
              <label htmlFor="invite-email">E-mail do convite</label>
              <input
                id="invite-email"
                type="email"
                required
                maxLength={320}
                autoComplete="off"
                value={email}
                onChange={(e) => changeEmail(e.target.value)}
              />
            </div>
          </div>
          {differentProfiles && (
            <p className="inline-info">
              Os perfis têm nome ou e-mail diferentes. Confira a correspondência e o endereço que
              receberá o convite.
            </p>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={!monday || !vr || matching}
              required
            />
            <span>Conferi os perfis Monday e VR Mais e confirmo que pertencem à mesma pessoa.</span>
          </label>
          <p className="muted">
            O convite concede acesso de Usuário e vale por 48 horas. A pessoa criará sua conta ao
            aceitá-lo.
          </p>
          <FormNotice error={action.error} />
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={onPeople}>
              Voltar para pessoas
            </button>
            <button
              type="submit"
              className="primary-button compact"
              disabled={
                !monday?.id ||
                !vr?.id ||
                !confirmed ||
                !name.trim() ||
                !email.trim() ||
                matching ||
                action.pending
              }
            >
              {action.pending ? 'Salvando e convidando…' : 'Confirmar e enviar convite'}
              <ArrowRight size={17} />
            </button>
          </div>
        </form>
      </fieldset>
    </>
  )
}
