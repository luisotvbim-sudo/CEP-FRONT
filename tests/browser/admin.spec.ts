import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture, ids, person, disabledBatch } from './admin-fixture'

test('people, search, invitation state and administrative accessibility', async ({
  page,
}, testInfo) => {
  const calls = await fixture(page)
  await expect(page.getByRole('heading', { name: 'Pessoas', exact: true })).toBeVisible()
  await expect(page.getByText('Aguardando aceite', { exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Pesquisar', exact: true }).fill('Ana')
  await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toHaveCount(0)
  await expect.poll(() => calls.some((c) => c.path.includes('search=Ana'))).toBe(true)
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(scan.violations).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  await page.evaluate(() => {
    const note = document.createElement('p')
    note.textContent = 'AMBIENTE DE TESTE — DADOS FICTÍCIOS'
    note.className = 'inline-info'
    document.querySelector('main')?.prepend(note)
  })
  await page.screenshot({
    path: `.local/admin-people-${testInfo.project.name}.png`,
    fullPage: true,
  })
})

test('association requires explicit confirmation and submits internal IDs with no role selection', async ({
  page,
}) => {
  const calls = await fixture(page)
  await page.getByRole('button', { name: 'Associar e convidar', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Confirmar e enviar convite' })).toBeDisabled()
  await page.getByRole('region', { name: 'Perfis Monday' }).getByRole('radio').check()
  await page.getByRole('region', { name: 'Perfis VR Mais' }).getByRole('radio').check()
  await expect(page.getByRole('button', { name: 'Confirmar e enviar convite' })).toBeDisabled()
  await page.getByLabel('Conferi os perfis Monday').check()
  await page.getByRole('button', { name: 'Confirmar e enviar convite' }).click()
  await expect(page.getByRole('heading', { name: 'Convite criado' })).toBeVisible()
  expect(calls.find((c) => c.path.endsWith('/people/invitations'))?.body).toEqual({
    email: person.email,
    displayName: person.displayName,
    mondayIdentityId: ids.monday,
    vrMaisIdentityId: ids.vr,
  })
})

test('duplicate association shows stable error and support code', async ({ page }) => {
  await fixture(page)
  await page.route('**/people/invitations', (route) =>
    route.fulfill({
      status: 409,
      json: { code: 'external_identity_already_mapped', correlationId: 'duplicate-trace' },
    }),
  )
  await page.getByRole('button', { name: 'Associar e convidar', exact: true }).first().click()
  await page.getByRole('region', { name: 'Perfis Monday' }).getByRole('radio').check()
  await page.getByRole('region', { name: 'Perfis VR Mais' }).getByRole('radio').check()
  await page.getByLabel('Conferi os perfis Monday').check()
  await page.getByRole('button', { name: 'Confirmar e enviar convite' }).click()
  await expect(page.getByRole('alert')).toContainText('já está associado')
  await expect(page.getByRole('alert')).toContainText('duplicate-trace')
})

test('synchronization shows disabled integrations independently and partial success', async ({
  page,
}) => {
  await fixture(page)
  await page.getByRole('button', { name: 'Sincronização', exact: true }).click()
  await expect(page.getByText('Integração desabilitada', { exact: true })).toHaveCount(2)
  await page.route('**/synchronizations?full=*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return route.fulfill({
      json: {
        ...disabledBatch,
        id: '70000000-0000-0000-0000-000000000002',
        status: 'partiallySucceeded',
        sources: [
          {
            source: 'monday',
            status: 'succeeded',
            coverageFrom: '2026-09-01',
            coverageTo: '2026-09-20',
            receivedCount: 3,
            timeRecordReceivedCount: 20,
            completeSnapshot: true,
          },
          disabledBatch.sources[1],
        ],
      },
    })
  })
  await page.getByRole('button', { name: 'Iniciar sincronização' }).click()
  await expect(page.getByRole('button', { name: 'Coleta em andamento' })).toBeDisabled()
  await expect(page.getByText('Sucesso parcial', { exact: true })).toBeVisible()
  await expect(page.getByText('Integração desabilitada', { exact: true })).toHaveCount(1)
  await expect(page.getByText('01/09/2026 a 20/09/2026')).toBeVisible()
})

test('teams can be created, edited, assigned and ended with effective dates', async ({ page }) => {
  const calls = await fixture(page)
  await page.getByRole('button', { name: 'Equipes', exact: true }).click()
  await page.getByLabel('Nome da nova equipe').fill('Equipe de teste')
  await page.getByRole('button', { name: 'Cadastrar equipe' }).click()
  await expect
    .poll(() => calls.some((c) => c.method === 'POST' && c.body?.name === 'Equipe de teste'))
    .toBe(true)
  await page.getByRole('button', { name: /Projetos de teste/ }).click()
  await page.getByLabel('Nome da equipe', { exact: true }).fill('Projetos revisados')
  await page.getByRole('button', { name: 'Salvar equipe' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Equipe atualizada' })).toBeVisible()
  await page.getByRole('radio', { name: /Admin de teste/ }).check()
  await page.getByLabel('Função na equipe', { exact: true }).selectOption('manager')
  await page.getByLabel('Início da vigência').fill('2026-09-01')
  await page.getByLabel('Fim da vigência (opcional)').fill('2026-09-30')
  await page.getByRole('button', { name: 'Adicionar vínculo', exact: true }).click()
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.method === 'POST' &&
          c.body?.userId === ids.user &&
          c.body?.role === 'manager' &&
          c.body?.effectiveTo === '2026-09-30',
      ),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Encerrar vínculo', exact: true }).click()
  await page.getByLabel('Data de fim', { exact: true }).fill('2026-09-21')
  await page.getByRole('button', { name: 'Confirmar encerramento' }).click()
  await expect
    .poll(() => calls.some((c) => c.path.endsWith('/end') && c.body.effectiveTo === '2026-09-21'))
    .toBe(true)
})

test('history enforces 60 inclusive days and preserves unknown duration', async ({ page }) => {
  const calls = await fixture(page)
  await page.getByRole('button', { name: 'Ver histórico' }).click()
  await page.getByLabel('De', { exact: true }).fill('2026-01-01')
  await page.getByLabel('Até', { exact: true }).fill('2026-03-02')
  await page.getByRole('button', { name: 'Consultar histórico' }).click()
  await expect(page.getByRole('alert')).toContainText('60 dias')
  expect(calls.filter((c) => c.path.includes('/history'))).toHaveLength(0)
  await page.getByLabel('De', { exact: true }).fill('2026-09-01')
  await page.getByLabel('Até', { exact: true }).fill('2026-09-21')
  await page.getByRole('button', { name: 'Consultar histórico' }).click()
  await expect(page.getByRole('cell', { name: 'Indisponível', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '00:00', exact: true })).toBeVisible()
  expect(calls.some((c) => c.path.includes(`workforcePersonId=${ids.person}`))).toBe(true)
  await expect(page.getByRole('link', { name: 'Abrir atividade' })).toHaveCount(0)
})

test('empty data and access denied never become fake results', async ({ page }) => {
  await fixture(page, { empty: true })
  await expect(page.getByText('Sua lista de pessoas começa aqui')).toBeVisible()
  await page.route('**/teams?*', (route) =>
    route.fulfill({ status: 403, json: { code: 'forbidden', correlationId: 'access-denied' } }),
  )
  await page.getByRole('button', { name: 'Equipes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('não tem acesso')
})

test('non-administrator has no administrative access or data queries', async ({ page }) => {
  const calls = await fixture(page, { role: 'user' })
  await expect(page.getByText(/Acesso administrativo indisponível/)).toBeVisible()
  expect(calls.some((c) => c.path.includes('/organization/'))).toBe(false)
})

test('expired session returns to login and preserves the support correlation', async ({ page }) => {
  await fixture(page)
  await page.route('**/teams?*', (route) =>
    route.fulfill({ status: 401, json: { code: 'unauthorized' } }),
  )
  let rotations = 0
  await page.route('**/auth/web/refresh', (route) => {
    rotations++
    return route.fulfill({
      status: 401,
      json: { code: 'invalid_refresh_token', correlationId: 'session-support' },
    })
  })
  await page.getByRole('button', { name: 'Equipes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
  await expect(page.getByText(/Sua sessão expirou/)).toContainText('session-support')
  expect(rotations).toBe(1)
})

test('connection failure exposes retry without fabricated data', async ({ page }) => {
  await fixture(page)
  await page.route('**/teams?*', (route) => route.abort('connectionfailed'))
  await page.getByRole('button', { name: 'Equipes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Verifique sua conexão')
  await expect(page.getByRole('button', { name: /Projetos de teste/ })).toHaveCount(0)
})

test('a delayed running poll cannot replace a completed synchronization', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: 'Sincronização', exact: true }).click()
  await expect(page.getByText('Integração desabilitada', { exact: true })).toHaveCount(2)
  const id = '70000000-0000-0000-0000-000000000003'
  let pollFinished = false
  await page.route('**/synchronizations/latest', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fulfill({ json: { ...disabledBatch, id, status: 'running', completedAt: null } })
    pollFinished = true
  })
  await page.route('**/synchronizations?full=*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1800))
    await route.fulfill({ json: { ...disabledBatch, id, status: 'partiallySucceeded' } })
  })
  await page.getByRole('button', { name: 'Iniciar sincronização' }).click()
  await expect(page.getByText('Sucesso parcial', { exact: true })).toBeVisible()
  await expect.poll(() => pollFinished).toBe(true)
  await expect(page.getByRole('button', { name: 'Iniciar sincronização' })).toBeEnabled()
  await expect(page.getByText('Sucesso parcial', { exact: true })).toBeVisible()
})

test('administrative forms remain accessible in each section', async ({ page }) => {
  await fixture(page)
  for (const section of ['Associar e convidar', 'Sincronização', 'Equipes', 'Histórico']) {
    await page.getByRole('button', { name: section, exact: true }).first().click()
    await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Carregando' })).toHaveCount(0)
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
      [],
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
  }
})

test('expired invitation requires confirmation before resending and refreshes its status', async ({
  page,
}) => {
  const calls = await fixture(page)
  let resent = false
  const expired = '2020-01-01T00:00:00Z'
  await page.route('**/organization/invitations', (route) =>
    route.fulfill({
      json: [
        {
          id: ids.invitation,
          expiresAt: resent ? person.invitationExpiresAt : expired,
          acceptedAt: null,
          revokedAt: null,
        },
      ],
    }),
  )
  await page.route('**/time-control/people?*', (route) =>
    route.fulfill({
      json: {
        items: [{ ...person, invitationExpiresAt: resent ? person.invitationExpiresAt : expired }],
        total: 1,
        page: 1,
        pageSize: 12,
      },
    }),
  )
  await page.route('**/organization/invitations/*/resend', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(new URL(route.request().url()).pathname).toBe(
      `/api/v1/organization/invitations/${ids.invitation}/resend`,
    )
    resent = true
    return route.fulfill({ status: 204 })
  })
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await expect(page.getByText('Expirado', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reenviar convite', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Confirmar reenvio do convite' })).toContainText(
    person.email,
  )
  expect(resent).toBe(false)
  await page.getByRole('button', { name: 'Confirmar reenvio' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'fila de envio' })).toBeVisible()
  await expect(page.getByText('Aguardando aceite', { exact: true })).toBeVisible()
  expect(calls.filter((call) => call.path.endsWith('/people/invitations'))).toHaveLength(0)
})

test('resend conflict preserves support code and revoked invitation cannot be resent', async ({
  page,
}) => {
  await fixture(page)
  let revoked = false
  await page.route('**/organization/invitations', (route) =>
    route.fulfill({
      json: [
        {
          id: ids.invitation,
          expiresAt: '2020-01-01T00:00:00Z',
          revokedAt: revoked ? '2020-01-02T00:00:00Z' : null,
        },
      ],
    }),
  )
  await page.route('**/organization/invitations/*/resend', (route) => {
    revoked = true
    return route.fulfill({
      status: 409,
      json: { code: 'invitation_not_pending', correlationId: 'resend-trace' },
    })
  })
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await page.getByRole('button', { name: 'Reenviar convite', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar reenvio' }).click()
  await expect(page.getByRole('alert')).toContainText('já foi aceito ou revogado')
  await expect(page.getByRole('alert')).toContainText('resend-trace')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await expect(page.getByText('Revogado', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reenviar convite', exact: true })).toHaveCount(0)
})

test('history keeps the server-side person name/email search from main', async ({ page }) => {
  const calls = await fixture(page)
  await page.getByRole('button', { name: 'Histórico', exact: true }).click()
  await page.getByLabel('Filtrar histórico por nome ou e-mail').fill('ana@example.invalid')
  await page.getByRole('button', { name: 'Consultar histórico', exact: true }).click()
  await expect
    .poll(() =>
      calls.some(
        (call) =>
          call.path.includes('/history?') &&
          new URLSearchParams(call.path.split('?')[1]).get('search') === 'ana@example.invalid',
      ),
    )
    .toBe(true)
})
