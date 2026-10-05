import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { admin, fixture, ids } from './admin-fixture'

const version = 'aaaaaaaa-0000-0000-0000-000000000001'
const analysis = {
  from: '2026-09-15',
  to: '2026-09-22',
  cutoff: '2026-09-22T14:50:00Z',
  toleranceMinutes: 30,
  vrSeconds: null,
  mondaySeconds: 3600,
  deltaSeconds: null,
  hasIssues: true,
  days: [
    {
      day: '2026-09-22',
      vrSeconds: null,
      mondaySeconds: 3600,
      deltaSeconds: null,
      partial: true,
      issues: ['incomplete'],
    },
  ],
}

function inboxPage(message: string) {
  return {
    items: [{ id: ids.batch, message, createdAt: '2026-09-22T14:50:00Z', analysis }],
    total: 1,
    page: 1,
    pageSize: 20,
  }
}

function dispatchPage(message: string, status = 'pending') {
  return {
    items: [
      {
        id: ids.batch,
        message,
        status,
        period: 'daily',
        createdAt: '2026-09-22T14:50:00Z',
        recipientCount: 2,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  }
}

test('global settings update and versioned deletion remain explicitly global', async ({ page }) => {
  await fixture(page)
  const saves: unknown[] = []
  await page.route('**/api/v1/time-control/settings', async (route) => {
    if (route.request().method() === 'PATCH') saves.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        toleranceMinutes: 30,
        timeZoneId: 'America/Sao_Paulo',
        automaticEnabled: false,
        version,
      },
    })
  })
  let deleted = false
  await page.route('**/api/v1/time-control/notification-schedules**', async (route) => {
    if (route.request().method() === 'DELETE') {
      deleted = true
      expect(route.request().url()).toContain(`version=${version}`)
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({
      json: deleted
        ? []
        : [
            {
              id: ids.batch,
              localTime: '11:50:00',
              message: 'Hora do almoço',
              kind: 'lunch',
              isEnabled: true,
              version,
            },
          ],
    })
  })
  await page.getByRole('button', { name: 'Configurações globais', exact: true }).click()
  await page.getByLabel('Tolerância diária em minutos').fill('45')
  await page.getByRole('button', { name: 'Salvar configuração global' }).click()
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0]).toEqual({ version, toleranceMinutes: 45, automaticEnabled: false })
  await page.getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(page.getByText('Isso afeta todas as organizações.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click()
  await expect(page.getByText('Nenhum agendamento', { exact: true })).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])
})

test('instant dispatch uses server preview, confirmation and one retained key after network uncertainty', async ({
  page,
}) => {
  await fixture(page)
  const bodies: { requestId: string; userId: string | null; period: string }[] = []
  await page.route('**/notification-dispatches**', async (route) => {
    if (route.request().url().includes('/preview')) {
      await route.fulfill({
        json: {
          from: '2026-09-15',
          to: '2026-09-22',
          cutoff: '2026-09-22T14:50:00Z',
          recipientCount: 2,
        },
      })
      return
    }
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postDataJSON())
      if (bodies.length === 1) {
        await route.abort()
        return
      }
      await route.fulfill({
        status: 202,
        json: { id: ids.batch, status: 'pending', recipientCount: 2 },
      })
      return
    }
    await route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } })
  })
  await page.getByRole('button', { name: 'Enviar aviso', exact: true }).click()
  await page.getByRole('combobox', { name: 'Análise', exact: true }).selectOption('sprint')
  await page.getByLabel('Mensagem', { exact: true }).fill('Confira a sprint')
  await expect(page.getByText('Prévia: 2 destinatário(s)', { exact: false })).toBeVisible()
  const send = page.getByRole('button', { name: 'Enviar notificação', exact: true })
  await expect(send).toBeDisabled()
  await page.getByLabel('Confirmo a mensagem').check()
  await send.click()
  await expect(page.getByRole('alert')).toBeVisible()
  await send.click()
  await expect(
    page.getByText('Solicitação registrada para 2 destinatário(s).', { exact: false }),
  ).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[0].requestId).toBe(bodies[1].requestId)
  expect(bodies[1].userId).toBeNull()
  expect(bodies[1].period).toBe('sprint')
})

test('inbox preserves unknown totals and original analysis; expanding does not mark read', async ({
  page,
}) => {
  await fixture(page)
  let read = false
  await page.route('**/api/v1/me/notifications**', async (route) => {
    if (route.request().method() === 'POST') {
      read = true
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({
      json: {
        items: read
          ? []
          : [
              {
                id: ids.batch,
                message: 'Confira a pendência',
                createdAt: '2026-09-22T14:50:00Z',
                analysis,
              },
            ],
        total: read ? 0 : 1,
        page: 1,
        pageSize: 20,
      },
    })
  })
  await page.getByRole('button', { name: 'Minhas notificações', exact: true }).click()
  await page.getByText('Ver análise anexada').click()
  await expect(page.getByText('Dados insuficientes', { exact: true })).toBeVisible()
  await expect(page.getByText('Indisponível', { exact: true }).first()).toBeVisible()
  expect(read).toBe(false)
  await page.getByRole('button', { name: 'Marcar como lida' }).click()
  await expect(page.getByText('Nenhuma notificação neste filtro')).toBeVisible()
})

test('inbox polling preserves expanded analysis and keyboard focus through refresh failure', async ({
  page,
}) => {
  await fixture(page)
  await page.clock.install()
  let requests = 0
  let release!: () => void
  await page.route('**/api/v1/me/notifications**', async (route) => {
    requests++
    if (requests === 2) {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await route.fulfill({ status: 503, json: { code: 'unavailable' } })
    } else await route.fulfill({ json: inboxPage('Último aviso confirmado') })
  })
  await page.getByRole('button', { name: 'Minhas notificações', exact: true }).click()
  await expect(page.getByText('Último aviso confirmado', { exact: true })).toBeVisible()
  const summary = page.getByText('Ver análise anexada', { exact: true })
  await summary.click()
  await summary.focus()
  const details = page.locator('.notification-list details')
  await page.clock.runFor(60_000)
  await expect.poll(() => requests).toBe(2)
  await expect(summary).toBeFocused()
  await expect(details).toHaveAttribute('open', '')
  await expect(
    page.getByRole('status').filter({ hasText: 'Atualizando notificações' }),
  ).toBeVisible()
  await expect(page.getByText('Dados insuficientes', { exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('Último aviso confirmado', { exact: true })).toBeVisible()
  await expect(details).toHaveAttribute('open', '')
  await expect(summary).toBeFocused()
})

test('inbox filter changes discard the old result and an outstanding poll', async ({ page }) => {
  await fixture(page)
  await page.clock.install()
  let oldRequests = 0
  let releaseOld!: () => void
  let releaseNew!: () => void
  let newStarted = false
  await page.route('**/api/v1/me/notifications**', async (route) => {
    const unread = new URL(route.request().url()).searchParams.get('unreadOnly') === 'true'
    if (unread) {
      oldRequests++
      if (oldRequests === 2)
        await new Promise<void>((resolve) => {
          releaseOld = resolve
        })
      await route.fulfill({
        json: inboxPage(oldRequests === 1 ? 'Filtro anterior' : 'Resposta tardia anterior'),
      })
    } else {
      newStarted = true
      await new Promise<void>((resolve) => {
        releaseNew = resolve
      })
      await route.fulfill({ json: inboxPage('Filtro atual confirmado') })
    }
  })
  await page.getByRole('button', { name: 'Minhas notificações', exact: true }).click()
  await expect(page.getByText('Filtro anterior', { exact: true })).toBeVisible()
  await page.clock.runFor(60_000)
  await expect.poll(() => oldRequests).toBe(2)
  await page.getByLabel('Somente não lidas').uncheck()
  await expect.poll(() => newStarted).toBe(true)
  await expect(page.getByText('Filtro anterior', { exact: true })).toHaveCount(0)
  const oldResponse = page.waitForResponse((response) => response.url().includes('unreadOnly=true'))
  releaseOld()
  await oldResponse
  await expect(page.getByText('Resposta tardia anterior', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Carregando dados…', { exact: true })).toBeVisible()
  releaseNew()
  await expect(page.getByText('Filtro atual confirmado', { exact: true })).toBeVisible()
  await expect(page.getByText('Resposta tardia anterior', { exact: true })).toHaveCount(0)
})

test('dispatch polling keeps the visible history and message draft while updating status', async ({
  page,
}) => {
  await fixture(page)
  await page.clock.install()
  let requests = 0
  let release!: () => void
  await page.route('**/notification-dispatches**', async (route) => {
    if (route.request().url().includes('/preview')) {
      await route.fulfill({ json: { from: '2026-09-22', to: '2026-09-22', recipientCount: 2 } })
      return
    }
    requests++
    if (requests === 2)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    await route.fulfill({
      json: dispatchPage('Envio confirmado', requests === 1 ? 'pending' : 'succeeded'),
    })
  })
  await page.getByRole('button', { name: 'Enviar aviso', exact: true }).click()
  await expect(page.getByText('Envio confirmado', { exact: true })).toBeVisible()
  const message = page.getByRole('textbox', { name: 'Mensagem', exact: true })
  await message.fill('Rascunho ainda em edição')
  await message.focus()
  await page.clock.runFor(15_000)
  await expect.poll(() => requests).toBe(2)
  await expect(page.getByText('Envio confirmado', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Atualizando histórico de envios' }),
  ).toBeVisible()
  await expect(message).toBeFocused()
  await expect(message).toHaveValue('Rascunho ainda em edição')
  release()
  await expect(page.getByText('Concluído · Diário', { exact: true })).toBeVisible()
  await expect(message).toBeFocused()
  await expect(message).toHaveValue('Rascunho ainda em edição')
})

test('an organization switch cannot restore dispatches from the previous pending poll', async ({
  page,
}) => {
  await fixture(page, { role: 'systemAdmin' })
  await page.clock.install()
  let oldRequests = 0
  let releaseOld!: () => void
  let releaseNew!: () => void
  let newStarted = false
  await page.route('**/notification-dispatches**', async (route) => {
    if (route.request().url().includes('/preview')) {
      await route.fulfill({ json: { from: '2026-09-22', to: '2026-09-22', recipientCount: 2 } })
      return
    }
    const previous = new URL(route.request().url()).searchParams.get('organizationId') === ids.org
    if (previous) {
      oldRequests++
      if (oldRequests === 2)
        await new Promise<void>((resolve) => {
          releaseOld = resolve
        })
      await route.fulfill({ json: dispatchPage('Histórico da organização anterior') })
    } else {
      newStarted = true
      await new Promise<void>((resolve) => {
        releaseNew = resolve
      })
      await route.fulfill({ json: dispatchPage('Histórico da organização atual') })
    }
  })
  const select = async (name: string) => {
    await page
      .getByRole('listitem')
      .filter({ hasText: name })
      .getByRole('button', { name: 'Administrar' })
      .click()
    await page.getByRole('button', { name: 'Enviar aviso', exact: true }).click()
  }
  await select('Organização A')
  await expect(page.getByText('Histórico da organização anterior', { exact: true })).toBeVisible()
  await page.getByLabel('Mensagem', { exact: true }).fill('Rascunho da organização anterior')
  await page.clock.runFor(15_000)
  await expect.poll(() => oldRequests).toBe(2)
  await page.getByRole('button', { name: 'Trocar organização' }).click()
  await select('Organização B')
  await expect.poll(() => newStarted).toBe(true)
  await expect(page.getByText('Histórico da organização anterior', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveValue('')
  const oldResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/notification-dispatches?') && response.url().includes(ids.org),
  )
  releaseOld()
  await oldResponse
  await expect(page.getByText('Histórico da organização anterior', { exact: true })).toHaveCount(0)
  releaseNew()
  await expect(page.getByText('Histórico da organização atual', { exact: true })).toBeVisible()
})

test('logout and another account discard an outstanding inbox poll', async ({ page }) => {
  await fixture(page)
  await page.clock.install()
  let oldRequests = 0
  let releaseOld!: () => void
  let nextAccount = false
  await page.route('**/api/v1/me/notifications**', async (route) => {
    if (!nextAccount) {
      oldRequests++
      if (oldRequests === 2)
        await new Promise<void>((resolve) => {
          releaseOld = resolve
        })
      await route.fulfill({ json: inboxPage('Aviso da conta anterior') })
    } else await route.fulfill({ json: inboxPage('Aviso da conta atual') })
  })
  await page.getByRole('button', { name: 'Minhas notificações', exact: true }).click()
  await expect(page.getByText('Aviso da conta anterior', { exact: true })).toBeVisible()
  await page.clock.runFor(60_000)
  await expect.poll(() => oldRequests).toBe(2)
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
  nextAccount = true
  const nextUser = {
    ...admin,
    id: ids.memberUser,
    email: 'other@example.invalid',
    displayName: 'Outra conta de teste',
  }
  await page.route('**/api/v1/me', async (route) => route.fulfill({ json: nextUser }))
  await page.route('**/api/v1/auth/web/login', async (route) =>
    route.fulfill({
      json: {
        accessToken: 'test-access',
        sessionExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        user: nextUser,
      },
    }),
  )
  await page.getByLabel('E-mail corporativo', { exact: true }).fill('other@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('Test-only-password')
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click()
  await expect(page.getByText('Outra conta de teste', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Minhas notificações', exact: true }).click()
  await expect(page.getByText('Aviso da conta atual', { exact: true })).toBeVisible()
  const oldResponse = page.waitForResponse((response) =>
    response.url().includes('/me/notifications'),
  )
  releaseOld()
  await oldResponse
  await expect(page.getByText('Aviso da conta anterior', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Aviso da conta atual', { exact: true })).toBeVisible()
})

test('native inbox intent is acknowledged after commit and while already open', async ({
  page,
}) => {
  const documentId = '80000000-0000-0000-0000-000000000001'
  await page.addInitScript((documentId) => {
    window.__CEP_DOCUMENT_ID__ = documentId
    const received: unknown[] = []
    const fixture = { received, refuse: false }
    Object.defineProperty(window, '__inboxAckFixture', { value: fixture })
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        webview: {
          postMessage: (message: { type: string }) => {
            if (message.type !== 'cep-inbox-consumed') return
            if (fixture.refuse) throw new Error('Detached fixture bridge')
            received.push({
              ...message,
              inboxCommitted: document.querySelector('h1')?.textContent === 'Minhas notificações',
            })
          },
        },
      },
    })
  }, documentId)
  await fixture(page)
  await expect(page.getByRole('button', { name: 'Minhas notificações', exact: true })).toBeVisible()
  await page.route('**/api/v1/me/notifications**', (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  )
  await page.evaluate(() => {
    window.__CEP_INBOX_INTENT__ = 'early-inbox-intent'
    window.dispatchEvent(new Event('cep-open-notifications'))
  })
  await expect(
    page.getByRole('heading', { name: 'Minhas notificações', exact: true }),
  ).toBeVisible()
  const received = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __inboxAckFixture: { received: unknown[] }
          }
        ).__inboxAckFixture.received,
    )
  await expect.poll(received).toEqual([
    {
      type: 'cep-inbox-consumed',
      token: 'early-inbox-intent',
      documentId,
      inboxCommitted: true,
    },
  ])
  expect(await page.evaluate(() => window.__CEP_INBOX_INTENT__)).toBeUndefined()
  await page.evaluate(() => {
    const fixture = (window as unknown as { __inboxAckFixture: { refuse: boolean } })
      .__inboxAckFixture
    fixture.refuse = true
    window.__CEP_INBOX_INTENT__ = 'repeat-inbox-intent'
    window.dispatchEvent(new Event('cep-open-notifications'))
  })
  expect(await page.evaluate(() => window.__CEP_INBOX_INTENT__)).toBe('repeat-inbox-intent')
  await expect.poll(received).toHaveLength(1)
  await page.evaluate(() => {
    const fixture = (window as unknown as { __inboxAckFixture: { refuse: boolean } })
      .__inboxAckFixture
    fixture.refuse = false
    window.dispatchEvent(new Event('cep-open-notifications'))
  })
  await expect.poll(received).toEqual([
    {
      type: 'cep-inbox-consumed',
      token: 'early-inbox-intent',
      documentId,
      inboxCommitted: true,
    },
    {
      type: 'cep-inbox-consumed',
      token: 'repeat-inbox-intent',
      documentId,
      inboxCommitted: true,
    },
  ])
  expect(await page.evaluate(() => window.__CEP_INBOX_INTENT__)).toBeUndefined()
})
