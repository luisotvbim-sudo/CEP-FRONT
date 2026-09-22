import { expect, type Page } from '@playwright/test'

export const ids = {
  org: '10000000-0000-0000-0000-000000000001',
  user: '20000000-0000-0000-0000-000000000001',
  person: '30000000-0000-0000-0000-000000000001',
  monday: '40000000-0000-0000-0000-000000000001',
  vr: '50000000-0000-0000-0000-000000000001',
  team: '60000000-0000-0000-0000-000000000001',
  batch: '70000000-0000-0000-0000-000000000001',
  assignment: '80000000-0000-0000-0000-000000000001',
  invitation: '90000000-0000-0000-0000-000000000001',
}
export const admin = {
  id: ids.user,
  displayName: 'Admin de teste',
  email: 'admin@example.invalid',
  role: 'organizationAdmin',
  organizationId: ids.org,
  status: 'active',
}
export const monday = {
  id: ids.monday,
  externalId: 'monday-external-123',
  displayName: 'Ana Exemplo',
  email: 'ana@example.invalid',
  source: 'monday',
  isActive: true,
  workforcePersonId: null,
}
export const vr = {
  id: ids.vr,
  externalId: 'vr-external-456',
  displayName: 'Ana Exemplo',
  email: 'ana@example.invalid',
  source: 'vrMais',
  isActive: true,
  workforcePersonId: null,
}
export const person = {
  id: ids.person,
  displayName: 'Ana Exemplo',
  email: 'ana@example.invalid',
  monday,
  vrMais: vr,
  userId: null,
  invitationId: ids.invitation,
  invitationExpiresAt: '2099-01-01T00:00:00Z',
  invitationAcceptedAt: null,
}
export const team = {
  id: ids.team,
  name: 'Projetos de teste',
  isActive: true,
  activeMembers: 1,
  activeManagers: 0,
}
export const disabledBatch = {
  id: ids.batch,
  status: 'failed',
  startedAt: '2026-09-21T12:00:00Z',
  completedAt: '2026-09-21T12:00:02Z',
  sources: ['monday', 'vrMais'].map((source) => ({
    source,
    status: 'failed',
    errorCode: source === 'monday' ? 'monday_not_configured' : 'vr_mais_not_configured',
    receivedCount: 0,
    timeRecordReceivedCount: 0,
    completeSnapshot: false,
    coverageFrom: null,
    coverageTo: null,
  })),
}

export async function fixture(page: Page, options: { role?: string; empty?: boolean } = {}) {
  const calls: { path: string; method: string; body: any }[] = []
  const currentUser = { ...admin, role: options.role || admin.role }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method()
    const body = request.postData() ? request.postDataJSON() : undefined
    calls.push({ path: path + url.search, method, body })
    if (path === '/api/v1/auth/login')
      return route.fulfill({
        json: {
          accessToken: 'test-access',
          refreshToken: 'test-refresh',
          accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          user: currentUser,
        },
      })
    if (path === '/api/v1/auth/logout') return route.fulfill({ status: 204 })
    expect(request.headers().authorization).toBe('Bearer test-access')
    if (path === '/api/v1/me') return route.fulfill({ json: currentUser })
    if (path === '/api/v1/organization/invitations')
      return route.fulfill({
        json: options.empty
          ? []
          : [
              {
                id: ids.invitation,
                expiresAt: person.invitationExpiresAt,
                revokedAt: null,
                acceptedAt: null,
              },
            ],
      })
    if (path.endsWith('/people/invitations'))
      return route.fulfill({
        status: 201,
        json: { person, invitation: { id: ids.invitation, expiresAt: person.invitationExpiresAt } },
      })
    if (path.endsWith('/people'))
      return route.fulfill({
        json: {
          items: options.empty ? [] : [person],
          total: options.empty ? 0 : 1,
          page: Number(url.searchParams.get('page') || 1),
          pageSize: 12,
        },
      })
    if (path.endsWith('/external-identities'))
      return route.fulfill({
        json: {
          items: options.empty ? [] : [url.searchParams.get('source') === 'monday' ? monday : vr],
          total: options.empty ? 0 : 1,
          page: 1,
          pageSize: 8,
        },
      })
    if (path.includes('/synchronizations')) return route.fulfill({ json: disabledBatch })
    if (path.endsWith('/users'))
      return route.fulfill({ json: { items: [admin], total: 1, page: 1, pageSize: 12 } })
    if (path.endsWith('/assignments/' + ids.assignment + '/end'))
      return route.fulfill({ json: { id: ids.assignment, effectiveTo: body.effectiveTo } })
    if (path.endsWith('/assignments'))
      return route.fulfill({
        json:
          method === 'GET'
            ? [
                {
                  id: ids.assignment,
                  userId: ids.user,
                  userDisplayName: admin.displayName,
                  userEmail: admin.email,
                  role: 'member',
                  effectiveFrom: '2026-01-01',
                  effectiveTo: null,
                },
              ]
            : { id: ids.assignment, ...body },
      })
    if (path.endsWith('/teams'))
      return route.fulfill({ json: method === 'GET' ? [team] : { ...team, name: body.name } })
    if (path.endsWith('/teams/' + ids.team)) return route.fulfill({ json: { ...team, ...body } })
    if (path.endsWith('/history'))
      return route.fulfill({
        json: {
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          generatedAt: '2026-09-21T12:00:00Z',
          people: options.empty
            ? []
            : [
                {
                  workforcePersonId: ids.person,
                  displayName: person.displayName,
                  email: person.email,
                  records: [
                    {
                      id: 'record-1',
                      source: 'vrMais',
                      workDate: '2026-09-20',
                      durationSeconds: null,
                      state: 'missing',
                      detailsJson: '{"timeCards":[]}',
                    },
                    {
                      id: 'record-2',
                      source: 'monday',
                      workDate: '2026-09-20',
                      durationSeconds: 0,
                      state: 'closed',
                      title: 'Atividade de teste',
                      url: 'javascript:alert(1)',
                    },
                  ],
                },
              ],
        },
      })
    throw new Error(`Unexpected API call: ${method} ${path}`)
  })
  await page.goto('/')
  await page.getByLabel('E-mail corporativo', { exact: true }).fill(admin.email)
  await page.getByLabel('Senha', { exact: true }).fill('Test-only-password')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  return calls
}
