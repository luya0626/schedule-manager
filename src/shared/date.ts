import type { RecurrenceRule, ScheduleItem } from './types'

export const pad = (value: number) => String(value).padStart(2, '0')

export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(value: string, days: number): string {
  const date = parseDateKey(value)
  date.setDate(date.getDate() + days)
  return toLocalDateKey(date)
}

export function addMonthsClamped(value: string, months: number): string {
  const date = parseDateKey(value)
  const originalDay = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(originalDay, lastDay))
  return toLocalDateKey(date)
}

export function nextOccurrence(value: string, rule: RecurrenceRule): string | null {
  if (rule === 'none') return null
  if (rule === 'daily') return addDays(value, 1)
  if (rule === 'weekly') return addDays(value, 7)
  if (rule === 'monthly') return addMonthsClamped(value, 1)
  let next = addDays(value, 1)
  while ([0, 6].includes(parseDateKey(next).getDay())) next = addDays(next, 1)
  return next
}

export function recurrenceDates(start: string, through: string, rule: RecurrenceRule): string[] {
  if (rule === 'none') return [start]
  if (rule === 'monthly') {
    const result: string[] = []
    let monthOffset = 0
    let occurrence = start
    while (occurrence <= through && monthOffset < 1200) {
      result.push(occurrence)
      monthOffset += 1
      occurrence = addMonthsClamped(start, monthOffset)
    }
    return result
  }
  const result: string[] = []
  let cursor: string | null = start
  let safety = 0
  while (cursor && cursor <= through && safety < 5000) {
    if (rule !== 'weekdays' || ![0, 6].includes(parseDateKey(cursor).getDay())) result.push(cursor)
    cursor = nextOccurrence(cursor, rule)
    safety += 1
  }
  return result
}

export function isOverdue(item: ScheduleItem, now = new Date()): boolean {
  if (item.status === 'completed') return false
  if (item.deadlineAt) return new Date(item.deadlineAt).getTime() < now.getTime()
  if (!item.scheduledDate) return false
  const end = item.endTime ?? item.startTime
  if (end) return new Date(`${item.scheduledDate}T${end}:00`).getTime() < now.getTime()
  return item.scheduledDate < toLocalDateKey(now)
}

export function itemSort(a: ScheduleItem, b: ScheduleItem): number {
  if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
  if (!a.startTime && b.startTime) return -1
  if (a.startTime && !b.startTime) return 1
  if (a.startTime !== b.startTime) return (a.startTime ?? '').localeCompare(b.startTime ?? '')
  const priorityOrder = { high: 0, medium: 1, low: 2, none: 3 }
  return priorityOrder[a.priority] - priorityOrder[b.priority] || a.createdAt.localeCompare(b.createdAt)
}
