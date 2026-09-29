import { expect, it } from 'vitest'
import { groupHistory, type PersonHistory } from './history-data'

it('groups by civil date, sorts days, retains source order and trusts server totals', () => {
  const person: PersonHistory = {
    days: [{ day: '2026-09-01', mondaySeconds: 999, vrSeconds: null, deltaSeconds: null }],
    records: [
      { id: 'later', workDate: '2026-09-02', source: 'monday' },
      { id: 'vr', workDate: '2026-09-01', source: 'vrMais', durationSeconds: null },
      { id: 'a', workDate: '2026-09-01', source: 'monday', durationSeconds: 20 },
      { id: 'b', workDate: '2026-09-01', source: 'monday', durationSeconds: 30 },
    ],
  }
  const before = structuredClone(person)
  const days = groupHistory(person)
  expect(days.map((day) => day.day)).toEqual(['2026-09-01', '2026-09-02'])
  expect(days[0].sources.monday.map((record) => record.id)).toEqual(['a', 'b'])
  expect(days[0].sources.vrMais[0].durationSeconds).toBeNull()
  expect(days[0].summary?.mondaySeconds).toBe(999)
  expect(days[1].summary).toBeUndefined()
  expect(person).toEqual(before)
})

it('keeps absent dates inspectable and does not invent records from summaries', () => {
  expect(groupHistory({ records: null })).toEqual([])
  expect(groupHistory({ days: [{ day: '2026-09-01', mondaySeconds: 0 }] })).toEqual([])
  const day = groupHistory({ records: [{ id: 'unknown' }] })[0]
  expect(day.day).toBeUndefined()
  expect(day.records).toHaveLength(1)
  expect(day.sources).toEqual({ monday: [], vrMais: [] })
})
