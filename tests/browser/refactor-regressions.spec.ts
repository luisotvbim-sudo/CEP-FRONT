import { expect, test } from '@playwright/test'
import { fixture, ids, person } from './admin-fixture'

test('duplicate history submissions keep the result of the single accepted request', async ({
  page,
}) => {
  await fixture(page)
  let requests = 0
  let release!: () => void
  await page.route('**/history?**', async (route) => {
    requests++
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ json: { people: [] } })
  })
  await page.getByRole('button', { name: 'Histórico', exact: true }).click()
  await page.getByRole('button', { name: 'Consultar histórico' }).evaluate((button) => {
    const form = (button as HTMLButtonElement).form!
    form.requestSubmit()
    form.requestSubmit()
  })
  await expect.poll(() => requests).toBe(1)
  release()
  await expect(
    page.getByText('Nenhum registro importado neste período', { exact: true }),
  ).toBeVisible()
  expect(requests).toBe(1)
})

test('editing a notification does not postpone the dispatch status poll', async ({ page }) => {
  await fixture(page)
  await page.clock.install()
  let polls = 0
  await page.route('**/notification-dispatches**', async (route) => {
    if (route.request().url().includes('/preview')) {
      await route.fulfill({ json: { from: '2026-09-01', to: '2026-09-01', recipientCount: 1 } })
    } else {
      polls++
      await route.fulfill({ json: { items: [], total: 0 } })
    }
  })
  await page.getByRole('button', { name: 'Enviar aviso', exact: true }).click()
  await expect.poll(() => polls).toBe(1)
  await page.clock.runFor(14_000)
  await page.getByLabel('Mensagem', { exact: true }).fill('Rascunho ainda em edição')
  await page.clock.runFor(1_100)
  await expect.poll(() => polls).toBe(2)
  await page.getByRole('button', { name: 'Pessoas', exact: true }).click()
  await page.clock.runFor(30_000)
  expect(polls).toBe(2)
})

test('a late failed search cannot replace a newer successful query', async ({ page }) => {
  await fixture(page)
  let release!: () => void
  let oldStarted = false
  await page.route('**/time-control/people?**', async (route) => {
    const search = new URL(route.request().url()).searchParams.get('search')
    if (search === 'old') {
      oldStarted = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await route.fulfill({
        status: 503,
        json: { code: 'unavailable', correlationId: 'stale-search' },
      })
    } else {
      await route.fulfill({
        json: { items: [{ ...person, displayName: 'Resultado atual' }], total: 1 },
      })
    }
  })
  await page.getByRole('searchbox', { name: 'Pesquisar', exact: true }).fill('old')
  await expect.poll(() => oldStarted).toBe(true)
  await page.getByRole('searchbox', { name: 'Pesquisar', exact: true }).fill('new')
  await expect(page.getByText('Resultado atual', { exact: true })).toBeVisible()
  const response = page.waitForResponse((value) => value.url().includes('search=old'))
  release()
  await response
  await expect(page.getByText('Resultado atual', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('late team history cannot appear after returning to the personal view', async ({ page }) => {
  await fixture(page, { role: 'user', leader: true })
  let release!: () => void
  let started = false
  await page.route('**/history?**', async (route) => {
    const selected = new URL(route.request().url()).searchParams.get('workforcePersonId')
    if (selected === ids.memberPerson) {
      started = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await route.fulfill({
        json: {
          people: [
            {
              workforcePersonId: ids.memberPerson,
              displayName: 'Outra pessoa',
              records: [
                {
                  id: 'old',
                  workDate: '2026-09-01',
                  title: 'Histórico anterior',
                  source: 'monday',
                },
              ],
            },
          ],
        },
      })
    } else {
      await route.fulfill({ json: { people: [] } })
    }
  })
  await page.getByRole('button', { name: 'Meus times' }).click()
  await page.getByRole('button', { name: 'Projetos de teste' }).click()
  await page.getByRole('button', { name: /Bia Exemplo/ }).click()
  await page.getByRole('button', { name: 'Consultar histórico' }).click()
  await expect.poll(() => started).toBe(true)
  await page.getByRole('button', { name: 'Minha jornada', exact: true }).click()
  release()
  await page.getByRole('button', { name: 'Meu histórico', exact: true }).click()
  await page.getByRole('button', { name: 'Consultar histórico' }).click()
  await expect(
    page.getByText('Nenhum registro importado neste período', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Outra pessoa', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Expandir dia/ })).toHaveCount(0)
})

test('organization creation is single-flight even for two synchronous form submissions', async ({
  page,
}) => {
  await fixture(page, { role: 'systemAdmin' })
  let saves = 0
  let release!: () => void
  await page.route('**/api/v1/admin/organizations', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    saves++
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ status: 201, json: { id: ids.org, name: 'Nova organização' } })
  })
  await page.getByRole('button', { name: 'Nova organização' }).click()
  await page.getByLabel('Nome', { exact: true }).fill('Nova organização')
  await page.getByLabel('Identificador', { exact: true }).fill('nova-organizacao')
  await page.getByLabel('E-mail do coordenador da organização').fill('fixture@example.invalid')
  await page.getByRole('button', { name: 'Criar e convidar' }).evaluate((button) => {
    const form = (button as HTMLButtonElement).form!
    form.requestSubmit()
    form.requestSubmit()
  })
  await expect.poll(() => saves).toBe(1)
  release()
  await expect(page.getByRole('status').filter({ hasText: 'Organização criada' })).toBeVisible()
  expect(saves).toBe(1)
})
