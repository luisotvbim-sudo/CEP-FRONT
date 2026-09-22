import { expect, test, type Page } from '@playwright/test'
import { fixture, monday, vr, ids } from './admin-fixture'

const secondMonday = {
  ...monday,
  id: '40000000-0000-0000-0000-000000000002',
  displayName: 'Bruno Monday',
  email: 'bruno@example.invalid',
}
const secondVr = {
  ...vr,
  id: '50000000-0000-0000-0000-000000000002',
  displayName: 'Bruno VR',
  email: 'bruno@example.invalid',
}
const openMatching = (page: Page) =>
  page.getByRole('button', { name: 'Associar e convidar', exact: true }).first().click()
const profiles = (page: Page, source: 'Monday' | 'VR Mais') =>
  page.getByRole('region', { name: `Perfis ${source}` })

for (const first of ['Monday', 'VR Mais'] as const) {
  test(`selecting ${first} updates the invitation and preselects the other source by exact email`, async ({
    page,
  }) => {
    const calls = await fixture(page)
    await page.route('**/external-identities?*', (route) => {
      const q = new URL(route.request().url()).searchParams
      const records = q.get('source') === 'monday' ? [monday, secondMonday] : [vr, secondVr]
      const items = q.get('search') ? records.filter((p) => p.email === q.get('search')) : records
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 8 } })
    })
    await openMatching(page)
    await profiles(page, first)
      .getByRole('radio', { name: /Ana Exemplo/ })
      .check()
    await expect(page.getByRole('status')).toContainText('pré-selecionado')
    await expect(
      profiles(page, first === 'Monday' ? 'VR Mais' : 'Monday').getByRole('radio', {
        name: /Ana Exemplo/,
      }),
    ).toBeChecked()
    await page.getByLabel('Conferi os perfis Monday').check()
    await profiles(page, first).getByRole('radio', { name: /Bruno/ }).check()
    await expect(page.getByLabel('Nome da pessoa', { exact: true })).toHaveValue(
      first === 'Monday' ? 'Bruno Monday' : 'Bruno VR',
    )
    await expect(page.getByLabel('E-mail do convite')).toHaveValue('bruno@example.invalid')
    await expect(
      profiles(page, first === 'Monday' ? 'VR Mais' : 'Monday').getByRole('radio', {
        name: /Bruno/,
      }),
    ).toBeChecked()
    await expect(page.getByLabel('Conferi os perfis Monday')).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Confirmar e enviar convite' })).toBeDisabled()
    await page.getByLabel('Conferi os perfis Monday').check()
    await page.getByRole('button', { name: 'Confirmar e enviar convite' }).click()
    await expect(page.getByRole('heading', { name: 'Convite criado' })).toBeVisible()
    expect(calls.find((c) => c.path.endsWith('/people/invitations'))?.body).toMatchObject({
      mondayIdentityId: secondMonday.id,
      vrMaisIdentityId: secondVr.id,
      email: 'bruno@example.invalid',
    })
  })
}

test('editing the recipient to a selected profile email updates the name and requires confirmation again', async ({
  page,
}) => {
  const calls = await fixture(page)
  const corporate = {
    ...vr,
    displayName: 'Ana Nome Corporativo',
    email: 'ana.corporativo@example.invalid',
  }
  await page.route('**/external-identities?*', (route) => {
    const q = new URL(route.request().url()).searchParams
    const items = q.get('search') ? [] : [q.get('source') === 'monday' ? monday : corporate]
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 8 } })
  })
  await openMatching(page)
  await profiles(page, 'Monday').getByRole('radio').check()
  await expect(page.getByRole('status')).toContainText(
    'Nenhum perfil disponível com o mesmo e-mail',
  )
  await profiles(page, 'VR Mais').getByRole('radio').check()
  await expect(page.getByLabel('Nome da pessoa', { exact: true })).toHaveValue(
    corporate.displayName,
  )
  await page.getByLabel('Conferi os perfis Monday').check()
  await page.getByLabel('E-mail do convite').fill(monday.email.toUpperCase())
  await expect(page.getByLabel('Nome da pessoa', { exact: true })).toHaveValue(monday.displayName)
  await expect(page.getByLabel('Conferi os perfis Monday')).not.toBeChecked()
  await page.getByLabel('E-mail do convite').fill('outro@example.invalid')
  await expect(page.getByLabel('Nome da pessoa', { exact: true })).toHaveValue(monday.displayName)
  expect(calls.filter((c) => c.path.endsWith('/people/invitations'))).toHaveLength(0)
})

for (const scenario of ['duplicate', 'incomplete', 'inactive', 'mapped'] as const) {
  test(`does not preselect an uncertain or unavailable match: ${scenario}`, async ({ page }) => {
    await fixture(page)
    await page.route('**/external-identities?*', (route) => {
      const q = new URL(route.request().url()).searchParams
      if (!q.get('search')) return route.fallback()
      const items =
        scenario === 'duplicate'
          ? [vr, { ...vr, id: secondVr.id }]
          : [
              {
                ...vr,
                isActive: scenario !== 'inactive',
                workforcePersonId: scenario === 'mapped' ? ids.person : null,
              },
            ]
      return route.fulfill({
        json: { items, total: scenario === 'incomplete' ? 9 : items.length, page: 1, pageSize: 8 },
      })
    })
    await openMatching(page)
    await profiles(page, 'Monday').getByRole('radio').check()
    await expect(page.getByRole('status')).toContainText('manualmente')
    await expect(profiles(page, 'VR Mais').getByRole('radio')).not.toBeChecked()
    await expect(page.getByLabel('Conferi os perfis Monday')).toBeDisabled()
  })
}

test('late lookup cannot restore the previous person and auto-selected profiles outside the page remain visible', async ({
  page,
}) => {
  await fixture(page)
  let finishedOld = false
  await page.route('**/external-identities?*', async (route) => {
    const q = new URL(route.request().url()).searchParams
    let items = q.get('source') === 'monday' ? [monday, secondMonday] : [vr]
    if (q.get('search') === monday.email) {
      await new Promise((resolve) => setTimeout(resolve, 450))
      items = [vr]
      await route.fulfill({ json: { items, total: 1, page: 1, pageSize: 8 } })
      finishedOld = true
      return
    }
    if (q.get('search') === secondMonday.email) items = [secondVr]
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 8 } })
  })
  await openMatching(page)
  await profiles(page, 'Monday')
    .getByRole('radio', { name: /Ana Exemplo/ })
    .check()
  await expect(page.getByRole('status')).toContainText('Buscando')
  await profiles(page, 'Monday').getByRole('radio', { name: /Bruno/ }).check()
  await expect(page.getByRole('status')).toContainText('pré-selecionado')
  await expect.poll(() => finishedOld).toBe(true)
  await expect(page.getByLabel('Nome da pessoa', { exact: true })).toHaveValue(
    secondMonday.displayName,
  )
  await expect(profiles(page, 'VR Mais').getByText('Bruno VR', { exact: true })).toBeVisible()
  await expect(
    profiles(page, 'VR Mais').getByRole('radio', { name: /Ana Exemplo/ }),
  ).not.toBeChecked()
})

test('lookup failures allow manual completion', async ({ page }) => {
  await fixture(page)
  await page.route('**/external-identities?*', (route) => {
    const q = new URL(route.request().url()).searchParams
    if (q.get('search')) return route.abort('connectionfailed')
    return route.fallback()
  })
  await openMatching(page)
  await profiles(page, 'Monday').getByRole('radio').check()
  await expect(page.getByRole('alert')).toContainText('Verifique sua conexão')
  await profiles(page, 'VR Mais').getByRole('radio').check()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('escolhida manualmente')
  await page.getByLabel('Conferi os perfis Monday').check()
  await expect(page.getByRole('button', { name: 'Confirmar e enviar convite' })).toBeEnabled()
})
