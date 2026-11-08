import writeXlsxFile, { type Sheet, type Row } from 'write-excel-file/browser'
import type { HoursReportData, HoursTotals } from './hours-api'
import { timestamp } from './format'
import { issueLabels } from '../notifications/labels'

const headers = [
  'Monday (h)',
  'VR Mais (h)',
  'Saldo comparável (h)',
  'Divergência absoluta (h)',
  'Pessoa-dias',
  'Com Monday',
  'Com VR Mais',
  'Comparáveis',
  'Acima da tolerância',
]
const hours = (seconds?: number | null) => (seconds == null ? null : seconds / 3600)
const cells = (totals: HoursTotals) => [
  hours(totals.mondaySeconds),
  hours(totals.vrSeconds),
  hours(totals.deltaSeconds),
  hours(totals.absoluteDivergenceSeconds),
  totals.personDays,
  totals.mondayDays,
  totals.vrDays,
  totals.comparableDays,
  totals.aboveToleranceDays,
]

async function buildHoursWorkbook(report: HoursReportData) {
  const team = 'team' in report ? report.team : undefined
  const totals = 'team' in report ? report.team.totals : report.organization
  const sheets: Sheet<File | Blob | ArrayBuffer>[] = []
  const addSheet = (
    name: string,
    titles: string[],
    numericHours: number[],
    rows: (string | number | null)[][],
  ) => {
    const data: Row[] = [
      titles.map((value) => ({
        value,
        color: '#FFFFFF',
        backgroundColor: '#91370E',
        fontWeight: 'bold',
      })),
      ...rows.map((row) =>
        row.map((value, i) =>
          typeof value === 'number' && numericHours.includes(i)
            ? { value, format: '0.0000' }
            : value,
        ),
      ),
    ]
    sheets.push({
      sheet: name,
      data,
      stickyRowsCount: 1,
      columns: titles.map((title, i) => ({ width: Math.max(i === 0 ? 26 : 16, title.length + 3) })),
    })
    return data
  }
  const summary = addSheet(
    team ? 'Resumo do time' : 'Organização',
    ['Escopo', ...headers],
    [1, 2, 3, 4],
    [[team?.name ?? 'Total da organização', ...cells(totals)]],
  )
  summary.push(
    [],
    ['Período', report.from, report.to],
    ['Consultado em (São Paulo)', timestamp(report.generatedAt)],
    ['Tolerância diária (min)', report.toleranceMinutes],
    ['Base', 'Histórico importado. Célula em branco = dado indisponível.'],
    ['Saldo e divergência', 'Somente pessoa-dias com comparação válida.'],
    team
      ? ['Vínculos', 'Somente os dias em que a pessoa fazia parte deste time.']
      : ['Times', 'Vínculos atuais, recortados pela vigência. Times podem compartilhar pessoas.'],
  )
  if ('teams' in report)
    addSheet(
      'Times',
      ['Time', ...headers],
      [1, 2, 3, 4],
      report.teams.map((item) => [item.name, ...cells(item.totals)]),
    )
  addSheet(
    team ? 'Pessoas do time' : 'Pessoas',
    ['Pessoa', ...headers],
    [1, 2, 3, 4],
    report.people.map((person) => [person.name, ...cells(person.totals)]),
  )
  const memberships = new Map<string, string[]>()
  if ('teams' in report) {
    const byPerson = new Map(report.people.map((person) => [person.id, person.name]))
    const rowsByTeam = report.teams.flatMap((item) =>
      item.members.map((member) => {
        for (const day of member.days) {
          const key = `${member.personId}/${day}`
          const names = memberships.get(key) ?? []
          names.push(item.name)
          memberships.set(key, names)
        }
        return [item.name, byPerson.get(member.personId) ?? 'Pessoa', ...cells(member.totals)]
      }),
    )
    addSheet('Pessoas por time', ['Time', 'Pessoa', ...headers], [2, 3, 4, 5], rowsByTeam)
  }
  addSheet(
    'Detalhe diário',
    [
      'Pessoa',
      'Dia',
      'Times incluídos',
      'Monday (h)',
      'VR Mais (h)',
      'Diferença (h)',
      'Dia parcial',
      'Ocorrências',
    ],
    [3, 4, 5],
    report.people.flatMap((person) =>
      person.days.map((day) => [
        person.name,
        day.day ?? '',
        team?.name ?? memberships.get(`${person.id}/${day.day}`)?.join(', ') ?? '',
        hours(day.mondaySeconds),
        hours(day.vrSeconds),
        hours(day.deltaSeconds),
        day.partial ? 'Sim' : 'Não',
        (day.issues ?? []).map((issue) => issueLabels[issue] ?? issue).join('; '),
      ]),
    ),
  )
  return writeXlsxFile(sheets).toBlob()
}

export async function downloadHoursWorkbook(report: HoursReportData, canDownload: () => boolean) {
  const file = await buildHoursWorkbook(report)
  if (!canDownload()) return
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = `cep-horas${'team' in report ? '-time' : ''}-${report.from}-a-${report.to}.xlsx`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
