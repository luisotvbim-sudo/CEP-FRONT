type QueryValues = Record<string, string | number | boolean | undefined>
export type Paged<T> = { items?: T[] | null; total?: number; page?: number; pageSize?: number }

export function query(values: QueryValues): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params.size ? `?${params}` : ''
}

// Global settings and the personal inbox must never inherit a selected organization.
export function organizationPath(path: string, organizationId?: string): string {
  if (!organizationId) return path
  if (!path.startsWith('/organization/')) throw new Error('Expected an organization route')
  const [route, search] = path.split('?')
  const params = new URLSearchParams(search)
  params.set('organizationId', organizationId)
  return `${route}?${params}`
}

// Fetch in small batches instead of opening one connection per page.
// Fail as a whole: a partial directory must not look like the complete recipient list.
export async function collectPages<T>(
  load: (page: number) => Promise<Paged<T>>,
  pageSize: number,
): Promise<T[]> {
  const first = await load(1)
  const pages = Math.ceil((first.total ?? first.items?.length ?? 0) / pageSize)
  const items = [...(first.items ?? [])]
  for (let page = 2; page <= pages; page += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, pages - page + 1) }, (_, index) => load(page + index)),
    )
    for (const result of batch) items.push(...(result.items ?? []))
  }
  return items
}
