import { expect, test } from '@playwright/test'
import { fixture, ids } from './admin-fixture'

test('global administrator selects and switches organization without mixing scope', async ({
  page,
}) => {
  const calls = await fixture(page, { role: 'systemAdmin' })
  await expect(page.getByRole('heading', { name: 'Organizações', exact: true })).toBeVisible()
  expect(calls.some((c) => c.path.startsWith('/api/v1/organization/'))).toBe(false)
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Organização A' })
    .getByRole('button', { name: 'Administrar' })
    .click()
  await expect(page.getByRole('heading', { name: 'Pessoas', exact: true })).toBeVisible()
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.path.includes('/time-control/people?') && c.path.includes(`organizationId=${ids.org}`),
      ),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Trocar organização' }).click()
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Organização B' })
    .getByRole('button', { name: 'Administrar' })
    .click()
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.path.includes('/time-control/people?') &&
          c.path.includes('organizationId=10000000-0000-0000-0000-000000000002'),
      ),
    )
    .toBe(true)
  expect(
    calls
      .filter((c) => c.path.startsWith('/api/v1/organization/'))
      .every((c) => c.path.includes('organizationId=')),
  ).toBe(true)
})
