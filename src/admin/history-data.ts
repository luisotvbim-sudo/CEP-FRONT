import type { History, TimeRecord } from './api'

export type PersonHistory = NonNullable<History['people']>[number]
type DailySummary = NonNullable<PersonHistory['days']>[number]
type HistoryDay = {
  day: string | undefined
  summary?: DailySummary
  records: TimeRecord[]
  sources: { monday: TimeRecord[]; vrMais: TimeRecord[] }
}

// Group only; all totals and differences stay authoritative in the API response.
export function groupHistory(person: PersonHistory): HistoryDay[] {
  const summaries = new Map((person.days ?? []).map((day) => [day.day, day]))
  const groups = new Map<string | undefined, HistoryDay>()
  for (const record of person.records ?? []) {
    let group = groups.get(record.workDate)
    if (!group) {
      group = {
        day: record.workDate,
        summary: summaries.get(record.workDate),
        records: [],
        sources: { monday: [], vrMais: [] },
      }
      groups.set(record.workDate, group)
    }
    group.records.push(record)
    if (record.source === 'monday' || record.source === 'vrMais')
      group.sources[record.source].push(record)
  }
  return [...groups.values()].sort((a, b) => (a.day ?? 'z').localeCompare(b.day ?? 'z'))
}
