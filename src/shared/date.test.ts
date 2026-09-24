import { describe, expect, it } from 'vitest'
import { addMonthsClamped, isOverdue, itemSort, recurrenceDates } from './date'
import type { ScheduleItem } from './types'

function item(overrides: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: 'item', title: '测试事项', notes: '', scheduledDate: null, startTime: null, endTime: null,
    deadlineAt: null, priority: 'none', status: 'pending', completedAt: null, goalId: null, listId: null,
    milestoneId: null, tags: [], reminderMinutes: null, recurrenceRule: 'none', recurrenceSeriesId: null,
    occurrenceDate: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('日期与重复规则', () => {
  it('月末重复会夹取到目标月份最后一天', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29')
    expect(recurrenceDates('2026-01-31', '2026-04-30', 'monthly')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'
    ])
  })

  it('工作日规则跳过周末', () => {
    expect(recurrenceDates('2026-08-28', '2026-09-02', 'weekdays')).toEqual([
      '2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02'
    ])
  })

  it('正确识别逾期但不标记已完成事项', () => {
    const now = new Date('2026-08-30T12:00:00+08:00')
    expect(isOverdue(item({ scheduledDate: '2026-08-29' }), now)).toBe(true)
    expect(isOverdue(item({ scheduledDate: '2026-08-29', status: 'completed' }), now)).toBe(false)
    expect(isOverdue(item({ scheduledDate: '2026-08-30', startTime: '13:00' }), now)).toBe(false)
  })

  it('全天事项在定时事项之前，并按优先级排序', () => {
    const values = [
      item({ id: 'timed', startTime: '09:00' }),
      item({ id: 'low', priority: 'low' }),
      item({ id: 'high', priority: 'high' })
    ].sort(itemSort)
    expect(values.map((value) => value.id)).toEqual(['high', 'low', 'timed'])
  })
})
