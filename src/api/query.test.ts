import { describe, expect, it } from 'vitest'
import { collectPages, organizationPath, query } from './query'

describe('query and organization boundaries', () => {
  it('encodes user input and keeps false and zero while dropping absent filters', () => {
    const values = new URLSearchParams(
      query({
        search: 'Luís + a&b@example.invalid',
        page: 0,
        full: false,
        empty: '',
        missing: undefined,
      }),
    )
    expect(Object.fromEntries(values)).toEqual({
      search: 'Luís + a&b@example.invalid',
      page: '0',
      full: 'false',
    })
    expect(query({ empty: '' })).toBe('')
  })
  it('replaces an existing scope, without duplicate organization parameters', () => {
    const path = organizationPath('/organization/users?search=a%26b&organizationId=old', 'org/new')
    const values = new URLSearchParams(path.split('?')[1])
    expect(values.get('search')).toBe('a&b')
    expect(values.getAll('organizationId')).toEqual(['org/new'])
  })
  it.each(['/me/notifications', '/time-control/settings', '/admin/organizations'])(
    'never applies selected scope to %s',
    (path) => {
      expect(() => organizationPath(path, 'org')).toThrow('organization route')
      expect(organizationPath(path)).toBe(path)
    },
  )
})

describe('complete paginated directories', () => {
  it('bounds concurrent requests and returns page order even when replies finish out of order', async () => {
    let active = 0
    let maximum = 0
    const result = await collectPages(async (page) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 12 - page))
      active--
      return { items: [page], total: 11 }
    }, 1)
    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(maximum).toBe(4)
  })
  it('does not return a partial recipient directory on failure', async () => {
    await expect(
      collectPages(async (page) => {
        if (page === 3) throw new Error('source unavailable')
        return { items: [page], total: 5 }
      }, 1),
    ).rejects.toThrow('source unavailable')
  })
  it('handles empty and legacy responses without requesting invented pages', async () => {
    expect(await collectPages(async () => ({ items: null, total: 0 }), 100)).toEqual([])
    expect(await collectPages(async () => ({ items: ['one'] }), 100)).toEqual(['one'])
  })
})
