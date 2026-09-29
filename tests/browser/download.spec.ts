import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('public Windows download works without a session and explains the test package', async ({ page }) => {
  const apiCalls: string[] = []
  page.on('request', (request) => { if (request.url().includes('/api/')) apiCalls.push(request.url()) })
  await page.goto('/download/')
  await expect(page).toHaveTitle('Download para Windows · CEP Horas')
  await expect(page.getByRole('heading', { name: 'Seu CEP Horas. Agora no Windows.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Baixar para Windows', exact: true })).toHaveAttribute('href', 'https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/desktop-v0.2.0.1-test/CEP-Horas-Windows.zip')
  await expect(page.getByText('Versão de teste · 0.2.0.1')).toBeVisible()
  await expect(page.getByText(/não tem assinatura digital nem atualização automática/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Baixar .NET Desktop Runtime' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Baixar WebView2 Runtime' })).toBeVisible()
  await page.getByText('O que acontece quando fecho a janela?').click()
  await expect(page.getByText('O CEP Horas continua na bandeja', { exact: false })).toBeVisible()
  expect(apiCalls).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations).toEqual([])
})

test('login links to the download page and the browser link returns to login', async ({ page }) => {
  await page.route('**/api/v1/auth/web/refresh', (route) => route.fulfill({ status: 401, json: { code: 'session_expired' } }))
  await page.goto('/')
  await page.getByRole('link', { name: 'Baixar aplicativo para Windows' }).click()
  await expect(page).toHaveURL(/\/download$/)
  await page.getByRole('link', { name: 'Acessar pelo navegador' }).click()
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible()
})
