import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('public Windows download keeps only the title and download card without a session', async ({
  page,
}) => {
  const apiCalls: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url())
  })
  await page.goto('/download/')
  await expect(page).toHaveTitle('Download para Windows · CEP Horas')
  await expect(
    page.getByRole('heading', { name: 'Seu CEP Horas. Agora no Windows.' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Baixar para Windows', exact: true }),
  ).toHaveAttribute(
    'href',
    'https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/installer-v0.4.13/CEP-Horas-Windows-win-x64.msi',
  )
  await expect(page.getByText('Beta · 0.4.13 · MSI', { exact: true })).toBeVisible()
  await expect(page.getByText('Windows 11 x64 · Pro / Enterprise / Education · 24H2+', { exact: true })).toBeVisible()
  await expect(page.getByText('Instalação pela TI · WebView2 por máquina.', { exact: true })).toBeVisible()
  await expect(
    page.getByText(/não tem assinatura digital nem atualização automática/),
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Baixar .NET Desktop Runtime' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Baixar WebView2 Runtime' })).toHaveCount(0)
  await expect(page.locator('main section')).toHaveCount(1)
  await expect(page.locator('main details')).toHaveCount(0)
  expect(apiCalls).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('login links to the download page and the browser link returns to login', async ({ page }) => {
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({ status: 401, json: { code: 'session_expired' } }),
  )
  await page.goto('/')
  await page.getByRole('link', { name: 'Baixar aplicativo para Windows' }).click()
  await expect(page).toHaveURL(/\/download$/)
  await page.getByRole('link', { name: 'Acessar pelo navegador' }).click()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
})
