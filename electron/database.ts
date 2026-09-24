import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite'
import { addDays, parseDateKey, recurrenceDates, toLocalDateKey } from '../src/shared/date'
import type {
  AppSettings,
  AppSnapshot,
  Goal,
  GoalInput,
  ItemInput,
  ListRecord,
  Milestone,
  RecurrenceRule,
  RecurrenceScope,
  ReminderView,
  ScheduleItem,
  Tag
} from '../src/shared/types'

type SqlRow = Record<string, unknown>

interface RecurrenceTemplate extends ItemInput {
  tagNames: string[]
}

export interface BackupPayload {
  format: 'schedule-manager-backup'
  formatVersion: 1
  exportedAt: string
  tables: Record<string, SqlRow[]>
}

const BACKUP_TABLES = [
  'lists',
  'tags',
  'goals',
  'milestones',
  'recurrence_series',
  'recurrence_exceptions',
  'items',
  'item_tags',
  'reminders',
  'settings'
] as const

const COLORS = ['#71998f', '#8f91bd', '#c08b7d', '#b39a64', '#7d9abb']
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

function nowIso(): string {
  return new Date().toISOString()
}

function nullable(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null
}

function normalizeDateTime(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function shiftDateTimeToOccurrence(value: string | null | undefined, sourceDate: string, occurrenceDate: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const source = parseDateKey(sourceDate)
  const dayOffset = Math.round((
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(source.getFullYear(), source.getMonth(), source.getDate())
  ) / 86_400_000)
  const target = parseDateKey(addDays(occurrenceDate, dayOffset))
  target.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), 0)
  return target.toISOString()
}

export class ScheduleDatabase {
  private readonly db: NodeDatabaseSync

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as SqlRow).user_version ?? 0)
    if (version < 1) {
      this.db.exec(`
      BEGIN;
      CREATE TABLE lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE goals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        start_date TEXT,
        end_date TEXT,
        status TEXT NOT NULL CHECK(status IN ('planned','active','completed','archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE milestones (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        target_date TEXT,
        manual_completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE recurrence_series (
        id TEXT PRIMARY KEY,
        rule TEXT NOT NULL CHECK(rule IN ('daily','weekdays','weekly','monthly')),
        base_date TEXT NOT NULL,
        until_date TEXT,
        template_json TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE recurrence_exceptions (
        series_id TEXT NOT NULL REFERENCES recurrence_series(id) ON DELETE CASCADE,
        occurrence_date TEXT NOT NULL,
        PRIMARY KEY(series_id, occurrence_date)
      );
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        scheduled_date TEXT,
        start_time TEXT,
        end_time TEXT,
        deadline_at TEXT,
        priority TEXT NOT NULL CHECK(priority IN ('none','low','medium','high')),
        status TEXT NOT NULL CHECK(status IN ('pending','completed')),
        completed_at TEXT,
        list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
        milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
        reminder_minutes INTEGER,
        recurrence_rule TEXT NOT NULL DEFAULT 'none',
        recurrence_series_id TEXT REFERENCES recurrence_series(id) ON DELETE SET NULL,
        occurrence_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(recurrence_series_id, occurrence_date)
      );
      CREATE TABLE item_tags (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(item_id, tag_id)
      );
      CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        trigger_at TEXT NOT NULL,
        fired INTEGER NOT NULL DEFAULT 0,
        seen INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(item_id)
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_items_scheduled_date ON items(scheduled_date);
      CREATE INDEX idx_items_completed_at ON items(completed_at);
      CREATE INDEX idx_items_status ON items(status);
      CREATE INDEX idx_reminders_trigger ON reminders(trigger_at, fired);
      PRAGMA user_version = 1;
      COMMIT;
      `)

      const createdAt = nowIso()
      this.db
        .prepare('INSERT INTO lists (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), '个人', COLORS[0], createdAt, createdAt)
      this.setSetting('theme', 'system')
      this.setSetting('notificationsEnabled', 'true')
    }

    if (version < 2) {
      this.db.exec(`
        BEGIN;
        ALTER TABLE items ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
        UPDATE items SET goal_id = (
          SELECT goal_id FROM milestones WHERE milestones.id = items.milestone_id
        ) WHERE milestone_id IS NOT NULL;
        CREATE INDEX idx_items_goal_id ON items(goal_id);
        PRAGMA user_version = 2;
        COMMIT;
      `)
    }
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  snapshot(): AppSnapshot {
    this.materializeRecurrences(addDays(toLocalDateKey(new Date()), 370))
    return {
      items: this.getItems(),
      lists: this.getLists(),
      tags: this.getTags(),
      goals: this.getGoals(),
      reminders: this.getReminderViews(),
      settings: this.getSettings()
    }
  }

  private getLists(): ListRecord[] {
    return (this.db.prepare('SELECT * FROM lists ORDER BY created_at').all() as SqlRow[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }))
  }

  private getTags(): Tag[] {
    return (this.db.prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE').all() as SqlRow[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }))
  }

  private getItems(): ScheduleItem[] {
    const rows = this.db
      .prepare('SELECT * FROM items ORDER BY COALESCE(scheduled_date, \'9999-12-31\'), COALESCE(start_time, \'\'), created_at')
      .all() as SqlRow[]
    const tagStatement = this.db.prepare(`
      SELECT t.* FROM tags t
      JOIN item_tags it ON it.tag_id = t.id
      WHERE it.item_id = ? ORDER BY t.name COLLATE NOCASE
    `)
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      notes: String(row.notes ?? ''),
      scheduledDate: row.scheduled_date ? String(row.scheduled_date) : null,
      startTime: row.start_time ? String(row.start_time) : null,
      endTime: row.end_time ? String(row.end_time) : null,
      deadlineAt: row.deadline_at ? String(row.deadline_at) : null,
      priority: row.priority as ScheduleItem['priority'],
      status: row.status as ScheduleItem['status'],
      completedAt: row.completed_at ? String(row.completed_at) : null,
      goalId: row.goal_id ? String(row.goal_id) : null,
      listId: row.list_id ? String(row.list_id) : null,
      milestoneId: row.milestone_id ? String(row.milestone_id) : null,
      tags: (tagStatement.all(String(row.id)) as SqlRow[]).map((tag) => ({
        id: String(tag.id),
        name: String(tag.name),
        color: String(tag.color),
        createdAt: String(tag.created_at),
        updatedAt: String(tag.updated_at)
      })),
      reminderMinutes: row.reminder_minutes === null ? null : Number(row.reminder_minutes),
      recurrenceRule: row.recurrence_rule as RecurrenceRule,
      recurrenceSeriesId: row.recurrence_series_id ? String(row.recurrence_series_id) : null,
      occurrenceDate: row.occurrence_date ? String(row.occurrence_date) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }))
  }

  private getGoals(): Goal[] {
    const goalRows = this.db.prepare('SELECT * FROM goals ORDER BY COALESCE(end_date, \'9999-12-31\'), created_at').all() as SqlRow[]
    const milestoneStatement = this.db.prepare('SELECT * FROM milestones WHERE goal_id = ? ORDER BY COALESCE(target_date, \'9999-12-31\'), created_at')
    const milestoneCountStatement = this.db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
      FROM items WHERE milestone_id = ?
    `)
    const goalCountStatement = this.db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
      FROM items WHERE goal_id = ?
    `)

    return goalRows.map((goalRow) => {
      const milestones: Milestone[] = (milestoneStatement.all(String(goalRow.id)) as SqlRow[]).map((row) => {
        const counts = milestoneCountStatement.get(String(row.id)) as SqlRow
        const itemCount = Number(counts.total ?? 0)
        const completedItemCount = Number(counts.completed ?? 0)
        const progress = itemCount > 0 ? Math.round((completedItemCount / itemCount) * 100) : Number(row.manual_completed) ? 100 : 0
        return {
          id: String(row.id),
          goalId: String(row.goal_id),
          title: String(row.title),
          targetDate: row.target_date ? String(row.target_date) : null,
          manualCompleted: Boolean(row.manual_completed),
          progress,
          itemCount,
          completedItemCount,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at)
        }
      })
      const goalCounts = goalCountStatement.get(String(goalRow.id)) as SqlRow
      const itemCount = Number(goalCounts.total ?? 0)
      const completedItemCount = Number(goalCounts.completed ?? 0)
      const progress = itemCount > 0 ? Math.round((completedItemCount / itemCount) * 100) : 0
      return {
        id: String(goalRow.id),
        name: String(goalRow.name),
        description: String(goalRow.description ?? ''),
        startDate: goalRow.start_date ? String(goalRow.start_date) : null,
        endDate: goalRow.end_date ? String(goalRow.end_date) : null,
        status: goalRow.status as Goal['status'],
        progress,
        itemCount,
        completedItemCount,
        milestones,
        createdAt: String(goalRow.created_at),
        updatedAt: String(goalRow.updated_at)
      }
    })
  }

  private getReminderViews(): ReminderView[] {
    return (this.db.prepare(`
      SELECT r.*, i.title AS item_title FROM reminders r
      JOIN items i ON i.id = r.item_id
      WHERE (r.fired = 1 AND r.seen = 0) OR r.trigger_at <= ?
      ORDER BY r.trigger_at DESC LIMIT 100
    `).all(new Date(Date.now() + 7 * 86_400_000).toISOString()) as SqlRow[]).map((row) => ({
      id: String(row.id),
      itemId: String(row.item_id),
      itemTitle: String(row.item_title),
      triggerAt: String(row.trigger_at),
      fired: Boolean(row.fired),
      seen: Boolean(row.seen)
    }))
  }

  private getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as SqlRow[]
    const values = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]))
    return {
      theme: values.theme === 'light' || values.theme === 'dark' ? values.theme : 'system',
      notificationsEnabled: values.notificationsEnabled !== 'false'
    }
  }

  saveItem(input: ItemInput, scope: RecurrenceScope = 'current'): AppSnapshot {
    if (!input.title.trim()) throw new Error('事项标题不能为空')
    const existing = input.id ? (this.db.prepare('SELECT * FROM items WHERE id = ?').get(input.id) as SqlRow | undefined) : undefined
    const rule = input.recurrenceRule ?? (existing?.recurrence_rule as RecurrenceRule | undefined) ?? 'none'

    this.transaction(() => {
      if (!existing) {
        if (rule !== 'none') this.createSeries(input, rule)
        else this.insertItem(input)
        return
      }

      const seriesId = existing.recurrence_series_id ? String(existing.recurrence_series_id) : null
      if (seriesId && scope === 'future') {
        this.updateSeriesFromOccurrence(seriesId, String(existing.occurrence_date), input, rule)
        return
      }
      if (!seriesId && rule !== 'none') {
        this.db.prepare('DELETE FROM items WHERE id = ?').run(String(existing.id))
        this.createSeries(input, rule)
        return
      }
      this.updateSingleItem(existing, input)
    })
    return this.snapshot()
  }

  private createSeries(input: ItemInput, rule: Exclude<RecurrenceRule, 'none'>): void {
    if (!input.scheduledDate) throw new Error('重复事项必须设置计划日期')
    const seriesId = randomUUID()
    const timestamp = nowIso()
    const template: RecurrenceTemplate = {
      ...input,
      id: undefined,
      recurrenceRule: rule,
      tagNames: input.tagNames ?? []
    }
    this.db.prepare(`
      INSERT INTO recurrence_series (id, rule, base_date, until_date, template_json, active, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 1, ?, ?)
    `).run(seriesId, rule, input.scheduledDate, JSON.stringify(template), timestamp, timestamp)
    this.materializeSeries(seriesId, addDays(toLocalDateKey(new Date()), 370))
  }

  private materializeRecurrences(throughDate: string): void {
    const rows = this.db.prepare('SELECT id FROM recurrence_series WHERE active = 1').all() as SqlRow[]
    this.transaction(() => rows.forEach((row) => this.materializeSeries(String(row.id), throughDate)))
  }

  private materializeSeries(seriesId: string, throughDate: string): void {
    const series = this.db.prepare('SELECT * FROM recurrence_series WHERE id = ? AND active = 1').get(seriesId) as SqlRow | undefined
    if (!series) return
    const template = JSON.parse(String(series.template_json)) as RecurrenceTemplate
    const through = series.until_date && String(series.until_date) < throughDate ? String(series.until_date) : throughDate
    const exceptions = new Set(
      (this.db.prepare('SELECT occurrence_date FROM recurrence_exceptions WHERE series_id = ?').all(seriesId) as SqlRow[]).map((row) => String(row.occurrence_date))
    )
    const exists = this.db.prepare('SELECT 1 FROM items WHERE recurrence_series_id = ? AND occurrence_date = ?')
    for (const date of recurrenceDates(String(series.base_date), through, series.rule as RecurrenceRule)) {
      if (exceptions.has(date) || exists.get(seriesId, date)) continue
      this.insertItem({
        ...template,
        scheduledDate: date,
        deadlineAt: template.scheduledDate
          ? shiftDateTimeToOccurrence(template.deadlineAt, template.scheduledDate, date)
          : template.deadlineAt
      }, seriesId, date)
    }
  }

  private insertItem(input: ItemInput, seriesId: string | null = null, occurrenceDate: string | null = null): string {
    const id = randomUUID()
    const timestamp = nowIso()
    const recurrenceRule = seriesId ? (input.recurrenceRule ?? 'none') : 'none'
    this.db.prepare(`
      INSERT INTO items (
        id, title, notes, scheduled_date, start_time, end_time, deadline_at, priority, status,
        completed_at, goal_id, list_id, milestone_id, reminder_minutes, recurrence_rule,
        recurrence_series_id, occurrence_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title.trim(),
      input.notes?.trim() ?? '',
      nullable(input.scheduledDate),
      nullable(input.startTime),
      nullable(input.endTime),
      normalizeDateTime(input.deadlineAt),
      input.priority ?? 'none',
      this.resolveGoalId(input),
      nullable(input.listId),
      nullable(input.milestoneId),
      input.reminderMinutes ?? null,
      recurrenceRule,
      seriesId,
      occurrenceDate,
      timestamp,
      timestamp
    )
    this.setItemTags(id, input.tagNames ?? [])
    this.syncReminder(id)
    return id
  }

  private updateSingleItem(existing: SqlRow, input: ItemInput): void {
    const id = String(existing.id)
    this.db.prepare(`
      UPDATE items SET title = ?, notes = ?, scheduled_date = ?, start_time = ?, end_time = ?,
        deadline_at = ?, priority = ?, goal_id = ?, list_id = ?, milestone_id = ?, reminder_minutes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.title.trim(),
      input.notes?.trim() ?? '',
      nullable(input.scheduledDate),
      nullable(input.startTime),
      nullable(input.endTime),
      normalizeDateTime(input.deadlineAt),
      input.priority ?? 'none',
      this.resolveGoalId(input),
      nullable(input.listId),
      nullable(input.milestoneId),
      input.reminderMinutes ?? null,
      nowIso(),
      id
    )
    this.setItemTags(id, input.tagNames ?? [])
    this.syncReminder(id)
  }

  private resolveGoalId(input: ItemInput): string | null {
    if ('goalId' in input) return nullable(input.goalId)
    if (!input.milestoneId) return null
    const legacyGoal = this.db.prepare('SELECT goal_id FROM milestones WHERE id = ?').get(input.milestoneId) as SqlRow | undefined
    return legacyGoal?.goal_id ? String(legacyGoal.goal_id) : null
  }

  private updateSeriesFromOccurrence(
    seriesId: string,
    occurrenceDate: string,
    input: ItemInput,
    rule: RecurrenceRule
  ): void {
    if (rule === 'none') {
      const previousDate = addDays(occurrenceDate, -1)
      this.db.prepare('UPDATE recurrence_series SET until_date = ?, active = 0, updated_at = ? WHERE id = ?').run(previousDate, nowIso(), seriesId)
      this.db.prepare("DELETE FROM items WHERE recurrence_series_id = ? AND occurrence_date >= ? AND status = 'pending'").run(seriesId, occurrenceDate)
      this.insertItem({ ...input, recurrenceRule: 'none' })
      return
    }
    const template: RecurrenceTemplate = {
      ...input,
      id: undefined,
      scheduledDate: occurrenceDate,
      recurrenceRule: rule,
      tagNames: input.tagNames ?? []
    }
    this.db.prepare(`
      UPDATE recurrence_series SET rule = ?, base_date = ?, until_date = NULL, template_json = ?, active = 1, updated_at = ?
      WHERE id = ?
    `).run(rule, occurrenceDate, JSON.stringify(template), nowIso(), seriesId)
    this.db.prepare("DELETE FROM items WHERE recurrence_series_id = ? AND occurrence_date >= ? AND status = 'pending'").run(seriesId, occurrenceDate)
    this.materializeSeries(seriesId, addDays(toLocalDateKey(new Date()), 370))
  }

  private setItemTags(itemId: string, tagNames: string[]): void {
    this.db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId)
    const cleanNames = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))]
    cleanNames.forEach((name, index) => {
      let tag = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name) as SqlRow | undefined
      if (!tag) {
        const tagId = randomUUID()
        const timestamp = nowIso()
        this.db.prepare('INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(tagId, name, COLORS[index % COLORS.length], timestamp, timestamp)
        tag = { id: tagId }
      }
      this.db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(itemId, String(tag.id))
    })
  }

  private syncReminder(itemId: string): void {
    this.db.prepare('DELETE FROM reminders WHERE item_id = ?').run(itemId)
    const item = this.db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as SqlRow | undefined
    if (!item || item.status === 'completed' || item.reminder_minutes === null) return
    let base: Date | null = null
    if (item.deadline_at) base = new Date(String(item.deadline_at))
    else if (item.scheduled_date) base = new Date(`${String(item.scheduled_date)}T${String(item.start_time ?? '09:00')}:00`)
    if (!base || Number.isNaN(base.getTime())) return
    const triggerAt = new Date(base.getTime() - Number(item.reminder_minutes) * 60_000).toISOString()
    const past = triggerAt <= nowIso()
    this.db.prepare(`
      INSERT INTO reminders (id, item_id, trigger_at, fired, seen, created_at) VALUES (?, ?, ?, ?, 0, ?)
    `).run(randomUUID(), itemId, triggerAt, past ? 1 : 0, nowIso())
  }

  toggleItem(id: string): AppSnapshot {
    this.transaction(() => {
      const item = this.db.prepare('SELECT status FROM items WHERE id = ?').get(id) as SqlRow | undefined
      if (!item) throw new Error('事项不存在')
      const completed = item.status !== 'completed'
      this.db.prepare('UPDATE items SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
        .run(completed ? 'completed' : 'pending', completed ? nowIso() : null, nowIso(), id)
      this.syncReminder(id)
    })
    return this.snapshot()
  }

  deleteItem(id: string, scope: RecurrenceScope = 'current'): AppSnapshot {
    this.transaction(() => {
      const item = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as SqlRow | undefined
      if (!item) return
      const seriesId = item.recurrence_series_id ? String(item.recurrence_series_id) : null
      if (!seriesId) {
        this.db.prepare('DELETE FROM items WHERE id = ?').run(id)
        return
      }
      const occurrenceDate = String(item.occurrence_date)
      if (scope === 'current') {
        this.db.prepare('INSERT OR IGNORE INTO recurrence_exceptions (series_id, occurrence_date) VALUES (?, ?)').run(seriesId, occurrenceDate)
        this.db.prepare('DELETE FROM items WHERE id = ?').run(id)
      } else {
        this.db.prepare('UPDATE recurrence_series SET until_date = ?, active = 0, updated_at = ? WHERE id = ?')
          .run(addDays(occurrenceDate, -1), nowIso(), seriesId)
        this.db.prepare("DELETE FROM items WHERE recurrence_series_id = ? AND occurrence_date >= ? AND status = 'pending'").run(seriesId, occurrenceDate)
      }
    })
    return this.snapshot()
  }

  saveList(input: { id?: string; name: string; color: string }): AppSnapshot {
    if (!input.name.trim()) throw new Error('清单名称不能为空')
    const timestamp = nowIso()
    if (input.id) {
      this.db.prepare('UPDATE lists SET name = ?, color = ?, updated_at = ? WHERE id = ?')
        .run(input.name.trim(), input.color, timestamp, input.id)
    } else {
      this.db.prepare('INSERT INTO lists (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), input.name.trim(), input.color, timestamp, timestamp)
    }
    return this.snapshot()
  }

  deleteList(id: string): AppSnapshot {
    this.db.prepare('DELETE FROM lists WHERE id = ?').run(id)
    return this.snapshot()
  }

  saveGoal(input: GoalInput): AppSnapshot {
    if (!input.name.trim()) throw new Error('目标名称不能为空')
    this.transaction(() => {
      const timestamp = nowIso()
      const goalId = input.id ?? randomUUID()
      if (input.id) {
        this.db.prepare(`
          UPDATE goals SET name = ?, description = ?, start_date = ?, end_date = ?, status = ?, updated_at = ? WHERE id = ?
        `).run(input.name.trim(), input.description?.trim() ?? '', nullable(input.startDate), nullable(input.endDate), input.status ?? 'active', timestamp, goalId)
      } else {
        this.db.prepare(`
          INSERT INTO goals (id, name, description, start_date, end_date, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(goalId, input.name.trim(), input.description?.trim() ?? '', nullable(input.startDate), nullable(input.endDate), input.status ?? 'active', timestamp, timestamp)
      }

      const keepIds: string[] = []
      for (const milestone of input.milestones ?? []) {
        if (!milestone.title.trim()) continue
        const milestoneId = milestone.id ?? randomUUID()
        keepIds.push(milestoneId)
        this.db.prepare(`
          INSERT INTO milestones (id, goal_id, title, target_date, manual_completed, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, target_date = excluded.target_date,
            manual_completed = excluded.manual_completed, updated_at = excluded.updated_at
        `).run(milestoneId, goalId, milestone.title.trim(), nullable(milestone.targetDate), milestone.manualCompleted ? 1 : 0, timestamp, timestamp)
      }
      if (keepIds.length) {
        const placeholders = keepIds.map(() => '?').join(',')
        this.db.prepare(`DELETE FROM milestones WHERE goal_id = ? AND id NOT IN (${placeholders})`).run(goalId, ...keepIds)
      } else {
        this.db.prepare('DELETE FROM milestones WHERE goal_id = ?').run(goalId)
      }
    })
    return this.snapshot()
  }

  deleteGoal(id: string): AppSnapshot {
    this.db.prepare('DELETE FROM goals WHERE id = ?').run(id)
    return this.snapshot()
  }

  private setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, nowIso())
  }

  saveSettings(settings: Partial<AppSettings>): AppSnapshot {
    if (settings.theme) this.setSetting('theme', settings.theme)
    if (settings.notificationsEnabled !== undefined) this.setSetting('notificationsEnabled', String(settings.notificationsEnabled))
    return this.snapshot()
  }

  markPastRemindersAsMissed(): void {
    this.db.prepare(`
      UPDATE reminders SET fired = 1, seen = 0
      WHERE fired = 0 AND trigger_at <= ?
    `).run(nowIso())
  }

  dueReminders(): Array<{ id: string; itemId: string; title: string }> {
    return this.db.prepare(`
      SELECT r.id, r.item_id, i.title FROM reminders r
      JOIN items i ON i.id = r.item_id
      WHERE r.fired = 0 AND i.status = 'pending' AND r.trigger_at <= ?
    `).all(nowIso()).map((row) => {
      const value = row as SqlRow
      return { id: String(value.id), itemId: String(value.item_id), title: String(value.title) }
    })
  }

  markReminderFired(id: string): void {
    this.db.prepare('UPDATE reminders SET fired = 1, seen = 0 WHERE id = ?').run(id)
  }

  markRemindersSeen(): AppSnapshot {
    this.db.prepare('UPDATE reminders SET seen = 1 WHERE fired = 1').run()
    return this.snapshot()
  }

  exportBackup(): BackupPayload {
    const tables: Record<string, SqlRow[]> = {}
    for (const table of BACKUP_TABLES) tables[table] = this.db.prepare(`SELECT * FROM ${table}`).all() as SqlRow[]
    return { format: 'schedule-manager-backup', formatVersion: 1, exportedAt: nowIso(), tables }
  }

  importBackup(payload: unknown): AppSnapshot {
    if (!this.isValidBackup(payload)) throw new Error('备份文件格式不正确或版本不受支持')
    const data = payload as BackupPayload
    const deleteOrder = ['reminders', 'item_tags', 'recurrence_exceptions', 'items', 'milestones', 'goals', 'recurrence_series', 'tags', 'lists', 'settings']
    this.transaction(() => {
      deleteOrder.forEach((table) => this.db.exec(`DELETE FROM ${table}`))
      for (const table of BACKUP_TABLES) {
        const rows = data.tables[table] ?? []
        for (const row of rows) {
          const columns = Object.keys(row)
          if (!columns.length) continue
          const placeholders = columns.map(() => '?').join(',')
          this.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`).run(...columns.map((column) => row[column] as never))
        }
      }
      this.db.prepare(`
        UPDATE items SET goal_id = (
          SELECT goal_id FROM milestones WHERE milestones.id = items.milestone_id
        ) WHERE goal_id IS NULL AND milestone_id IS NOT NULL
      `).run()
    })
    return this.snapshot()
  }

  private isValidBackup(payload: unknown): payload is BackupPayload {
    if (!payload || typeof payload !== 'object') return false
    const candidate = payload as Partial<BackupPayload>
    if (candidate.format !== 'schedule-manager-backup' || candidate.formatVersion !== 1) return false
    if (!candidate.tables || typeof candidate.tables !== 'object') return false
    return BACKUP_TABLES.every((table) => Array.isArray(candidate.tables?.[table]))
  }
}
