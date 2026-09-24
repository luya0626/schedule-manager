import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScheduleDatabase } from './database'

const temporaryDirectories: string[] = []

function createDatabase(): ScheduleDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'schedule-manager-test-'))
  temporaryDirectories.push(directory)
  return new ScheduleDatabase(join(directory, 'test.sqlite'))
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop()
    if (directory?.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true })
  }
})

describe('ScheduleDatabase', () => {
  it('保存、完成和重新打开事项时维护独立完成时间', () => {
    const db = createDatabase()
    let snapshot = db.saveItem({ title: '完成数据层', scheduledDate: '2026-08-30', tagNames: ['开发'] })
    const id = snapshot.items.find((entry) => entry.title === '完成数据层')!.id
    snapshot = db.toggleItem(id)
    expect(snapshot.items.find((entry) => entry.id === id)).toMatchObject({ status: 'completed' })
    expect(snapshot.items.find((entry) => entry.id === id)?.completedAt).toBeTruthy()
    snapshot = db.toggleItem(id)
    expect(snapshot.items.find((entry) => entry.id === id)).toMatchObject({ status: 'pending', completedAt: null })
    db.close()
  })

  it('为重复事项生成唯一实例，删除本次后不会重新出现', () => {
    const db = createDatabase()
    let snapshot = db.saveItem({ title: '每日复盘', scheduledDate: '2026-08-30', recurrenceRule: 'daily' })
    const first = snapshot.items.find((entry) => entry.title === '每日复盘' && entry.occurrenceDate === '2026-08-30')!
    expect(snapshot.items.some((entry) => entry.occurrenceDate === '2026-08-31')).toBe(true)
    const recurringItems = snapshot.items.filter((entry) => entry.recurrenceSeriesId === first.recurrenceSeriesId)
    expect(new Set(recurringItems.map((entry) => entry.occurrenceDate)).size).toBe(recurringItems.length)
    snapshot = db.deleteItem(first.id, 'current')
    expect(snapshot.items.some((entry) => entry.occurrenceDate === '2026-08-30')).toBe(false)
    db.close()
  })

  it('重复实例会把截止时间平移到各自发生日期', () => {
    const db = createDatabase()
    const snapshot = db.saveItem({
      title: '按时提交',
      scheduledDate: '2026-08-30',
      deadlineAt: '2026-08-30T18:00:00+08:00',
      recurrenceRule: 'daily'
    })
    const next = snapshot.items.find((entry) => entry.title === '按时提交' && entry.occurrenceDate === '2026-08-31')
    expect(next?.deadlineAt).toBe('2026-08-31T10:00:00.000Z')
    db.close()
  })

  it('按直接关联任务的完成比例计算目标进度，独立任务不参与', () => {
    const db = createDatabase()
    let snapshot = db.saveGoal({ name: '发布应用', status: 'active' })
    const goalId = snapshot.goals[0].id
    snapshot = db.saveItem({ title: '任务一', goalId })
    snapshot = db.saveItem({ title: '任务二', goalId })
    snapshot = db.saveItem({ title: '独立任务' })
    const firstId = snapshot.items.find((entry) => entry.title === '任务一')!.id
    snapshot = db.toggleItem(firstId)
    expect(snapshot.goals[0].itemCount).toBe(2)
    expect(snapshot.goals[0].completedItemCount).toBe(1)
    expect(snapshot.goals[0].progress).toBe(50)
    db.close()
  })

  it('兼容旧里程碑关联并自动转换为直接目标关联', () => {
    const db = createDatabase()
    let snapshot = db.saveGoal({ name: '旧目标', status: 'active', milestones: [{ title: '旧里程碑' }] })
    const goalId = snapshot.goals[0].id
    const milestoneId = snapshot.goals[0].milestones[0].id
    snapshot = db.saveItem({ title: '旧任务', milestoneId })
    expect(snapshot.items.find((entry) => entry.title === '旧任务')?.goalId).toBe(goalId)
    db.close()
  })

  it('导出的版本化备份可以恢复全部核心数据', () => {
    const source = createDatabase()
    const goal = source.saveGoal({ name: '备份目标', status: 'active' }).goals[0]
    source.saveItem({ title: '需要备份', scheduledDate: '2026-09-01', goalId: goal.id })
    const backup = source.exportBackup()
    const target = createDatabase()
    const restored = target.importBackup(backup)
    expect(backup.formatVersion).toBe(1)
    expect(restored.items.some((entry) => entry.title === '需要备份')).toBe(true)
    expect(restored.items.find((entry) => entry.title === '需要备份')?.goalId).toBe(restored.goals[0].id)
    source.close()
    target.close()
  })
})
