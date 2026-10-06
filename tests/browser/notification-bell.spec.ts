import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture, ids } from './admin-fixture'

for (const leader of [false, true]) {
  test(`personal bell preserves explicit reading and accessible navigation (${leader ? 'leader' : 'member'})`, async ({
    page,
  }) => {
    let read = false
    const writes: string[] = []
    await fixture(page, { role: 'user', leader })
    await expect(
      page.getByRole('button', { name: 'Minhas notificações', exact: true }),
    ).toBeVisible()
    await page.route('**/api/v1/me/notifications**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET') {
        writes.push(url.pathname)
        read = true
        return route.fulfill({ status: 204 })
      }
      const unread = url.searchParams.get('unreadOnly') === 'true'
      await route.fulfill({
        json: {
          items:
            read && unread
              ? []
              : [
                  {
                    id: ids.batch,
                    message: 'Aviso fictício completo '.repeat(30),
                    createdAt: '2026-09-22T14:50:00Z',
                    readAt: read ? '2026-09-22T15:00:00Z' : null,
                    analysis: { from: '2026-09-22', to: '2026-09-22', days: [] },
                  },
                ],
          total: read && unread ? 0 : 1,
          page: 1,
          pageSize: 20,
        },
      })
    })
    const bell = page.getByRole('button', { name: 'Minhas notificações', exact: true })
    await expect(page.locator('nav').getByText('Minhas notificações')).toHaveCount(0)
    await bell.click()
    const panel = page.getByRole('region', { name: 'Minhas notificações' })
    await expect(panel).toBeFocused()
    await expect(
      panel.getByText('Aviso fictício completo '.repeat(30).trim(), { exact: true }),
    ).toBeVisible()
    expect(writes).toEqual([])
    await page.keyboard.press('Escape')
    await expect(bell).toBeFocused()
    await expect(bell).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('button', { name: 'Ver meus avisos' }).click()
    await expect(panel).toBeVisible()
    await panel.getByText('Ver análise anexada').click()
    await panel.getByRole('button', { name: 'Marcar como lida' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: '0 notificações não lidas' }),
    ).toHaveCount(1)
    expect(writes).toEqual([`/api/v1/me/notifications/${ids.batch}/read`])
    await panel.getByLabel('Somente não lidas').uncheck()
    await expect(panel.getByText('Lida ·', { exact: false })).toBeVisible()
    expect(
      (await new AxeBuilder({ page }).include('.notification-dropdown').analyze()).violations,
    ).toEqual([])
    const box = await panel.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await page.screenshot({
      path: `test-results/bell-${leader ? 'leader' : 'member'}-${test.info().project.name}.png`,
    })
    await page.getByRole('heading', { name: 'Minha jornada', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await bell.click()
    await panel.getByRole('button', { name: 'Ver todas as notificações' }).click()
    await expect(
      page.getByRole('heading', { name: 'Minhas notificações', exact: true }),
    ).toBeVisible()
  })
}
