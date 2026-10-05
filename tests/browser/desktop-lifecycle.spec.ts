import { test, expect } from '@playwright/test'

test('native marker without a bridge shows recovery and never falls back to HTTP', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__CEP_DESKTOP__ = true
    window.__CEP_DOCUMENT_ID__ = '80000000-0000-0000-0000-000000000001'
  })
  await page.route('**/api/v1/**', () => {
    throw new Error('Unavailable native bridge must not use web authentication')
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('comunicação nativa está indisponível')
})

test('React confirms bridge challenge while session transport fails and preserves early inbox intent', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__CEP_DESKTOP__ = true
    window.__CEP_DOCUMENT_ID__ = '80000000-0000-0000-0000-000000000001'
    const listeners = new Set<(event: { data: object }) => void>()
    const received: object[] = []
    Object.defineProperty(window, '__lifecycleTest', {
      value: {
        received,
        deliver: (data: object) => listeners.forEach((listener) => listener({ data })),
      },
    })
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        webview: {
          addEventListener: (_type: string, listener: (event: { data: object }) => void) =>
            listeners.add(listener),
          removeEventListener: (_type: string, listener: (event: { data: object }) => void) =>
            listeners.delete(listener),
          postMessage: (message: { id?: string; type: string }) => {
            received.push(message)
            if (message.type === 'cep-auth')
              queueMicrotask(() =>
                listeners.forEach((listener) =>
                  listener({
                    data: {
                      id: message.id,
                      ok: false,
                      error: { status: 503, code: 'network_error', transportFailure: true },
                    },
                  }),
                ),
              )
          },
        },
      },
    })
  })
  await page.goto('/')
  await page.getByRole('heading', { name: 'Bom ter você aqui.' }).waitFor()
  const token = 'a'.repeat(32)
  await page.evaluate((token) => {
    const fixture = (window as unknown as { __lifecycleTest: { deliver: (data: object) => void } })
      .__lifecycleTest
    fixture.deliver({ type: 'cep-lifecycle-probe', version: 1, token })
    fixture.deliver({ type: 'cep-inbox-open', token: 'early-inbox' })
  }, token)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fixture = (
          window as unknown as {
            __lifecycleTest: {
              received: { type: string; token: string; mounted: boolean; visible: boolean }[]
            }
          }
        ).__lifecycleTest
        return fixture.received.find((message) => message.type === 'cep-lifecycle')
      }),
    )
    .toEqual({
      type: 'cep-lifecycle',
      documentId: '80000000-0000-0000-0000-000000000001',
      version: 1,
      token,
      mounted: true,
      visible: true,
      assetFault: false,
    })
  expect(await page.evaluate(() => window.__CEP_INBOX_INTENT__)).toBe('early-inbox')
  await page.evaluate(() => {
    window.__CEP_BOOT_FAULT__ = true
    const fixture = (window as unknown as { __lifecycleTest: { deliver: (data: object) => void } })
      .__lifecycleTest
    fixture.deliver({ type: 'cep-lifecycle-probe', version: 1, token: 'b'.repeat(32) })
  })
  expect(
    await page.evaluate(() => {
      const fixture = (
        window as unknown as { __lifecycleTest: { received: { assetFault?: boolean }[] } }
      ).__lifecycleTest
      return fixture.received.at(-1)?.assetFault
    }),
  ).toBe(true)
})
