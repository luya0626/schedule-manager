export type Priority = 'none' | 'low' | 'medium' | 'high'
export type ItemStatus = 'pending' | 'completed'
export type RecurrenceRule = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type RecurrenceScope = 'current' | 'future'
export type GoalStatus = 'planned' | 'active' | 'completed' | 'archived'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface ScheduleItem {
  id: string
  title: string
  notes: string
  scheduledDate: string | null
  startTime: string | null
  endTime: string | null
  deadlineAt: string | null
  priority: Priority
  status: ItemStatus
  completedAt: string | null
  goalId: string | null
  listId: string | null
  milestoneId: string | null
  tags: Tag[]
  reminderMinutes: number | null
  recurrenceRule: RecurrenceRule
  recurrenceSeriesId: string | null
  occurrenceDate: string | null
  createdAt: string
  updatedAt: string
}

export interface ItemInput {
  id?: string
  title: string
  notes?: string
  scheduledDate?: string | null
  startTime?: string | null
  endTime?: string | null
  deadlineAt?: string | null
  priority?: Priority
  goalId?: string | null
  listId?: string | null
  milestoneId?: string | null
  tagNames?: string[]
  reminderMinutes?: number | null
  recurrenceRule?: RecurrenceRule
}

export interface ListRecord {
  id: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
}

export interface Tag {
  id: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
}

export interface Milestone {
  id: string
  goalId: string
  title: string
  targetDate: string | null
  manualCompleted: boolean
  progress: number
  itemCount: number
  completedItemCount: number
  createdAt: string
  updatedAt: string
}

export interface Goal {
  id: string
  name: string
  description: string
  startDate: string | null
  endDate: string | null
  status: GoalStatus
  progress: number
  itemCount: number
  completedItemCount: number
  milestones: Milestone[]
  createdAt: string
  updatedAt: string
}

export interface MilestoneInput {
  id?: string
  title: string
  targetDate?: string | null
  manualCompleted?: boolean
}

export interface GoalInput {
  id?: string
  name: string
  description?: string
  startDate?: string | null
  endDate?: string | null
  status?: GoalStatus
  milestones?: MilestoneInput[]
}

export interface ReminderView {
  id: string
  itemId: string
  itemTitle: string
  triggerAt: string
  fired: boolean
  seen: boolean
}

export interface AppSettings {
  theme: ThemeMode
  notificationsEnabled: boolean
}

export interface AppSnapshot {
  items: ScheduleItem[]
  lists: ListRecord[]
  tags: Tag[]
  goals: Goal[]
  reminders: ReminderView[]
  settings: AppSettings
}

export interface HistoryFilters {
  query?: string
  startDate?: string
  endDate?: string
  listId?: string
  tagId?: string
  goalId?: string
}

export interface BackupResult {
  success: boolean
  path?: string
  message?: string
}

export interface SchedulerAPI {
  bootstrap(): Promise<AppSnapshot>
  saveItem(input: ItemInput, scope?: RecurrenceScope): Promise<AppSnapshot>
  toggleItem(id: string): Promise<AppSnapshot>
  deleteItem(id: string, scope?: RecurrenceScope): Promise<AppSnapshot>
  saveList(input: { id?: string; name: string; color: string }): Promise<AppSnapshot>
  deleteList(id: string): Promise<AppSnapshot>
  saveGoal(input: GoalInput): Promise<AppSnapshot>
  deleteGoal(id: string): Promise<AppSnapshot>
  markRemindersSeen(): Promise<AppSnapshot>
  saveSettings(settings: Partial<AppSettings>): Promise<AppSnapshot>
  exportBackup(): Promise<BackupResult>
  importBackup(): Promise<BackupResult>
  onReminderOpen(callback: (itemId: string) => void): () => void
}
