import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  History,
  Inbox,
  ListTodo,
  Moon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Target,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { isOverdue, itemSort, pad, parseDateKey, toLocalDateKey } from './shared/date'
import type {
  AppSettings,
  AppSnapshot,
  Goal,
  GoalInput,
  ItemInput,
  RecurrenceRule,
  RecurrenceScope,
  ScheduleItem
} from './shared/types'

type Page = 'calendar' | 'tasks' | 'unscheduled' | 'goals' | 'history' | 'settings'

const EMPTY_SNAPSHOT: AppSnapshot = {
  items: [], lists: [], tags: [], goals: [], reminders: [], settings: { theme: 'system', notificationsEnabled: true }
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const PRIORITY_LABEL = { none: '无', low: '低', medium: '中', high: '高' }
const RECURRENCE_LABEL: Record<RecurrenceRule, string> = {
  none: '不重复', daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月'
}
const GOAL_STATUS_LABEL = { planned: '计划中', active: '进行中', completed: '已完成', archived: '已归档' }

function monthTitle(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`
}

function formatDate(value: string | null | undefined, includeYear = true): string {
  if (!value) return '未设置'
  const date = parseDateKey(value.slice(0, 10))
  return new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' } : {}), month: 'short', day: 'numeric', weekday: 'short'
  }).format(date)
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function calendarDays(cursor: Date): string[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const mondayIndex = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - mondayIndex)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return toLocalDateKey(date)
  })
}

function useTheme(settings: AppSettings): void {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])
}

export default function App(): ReactNode {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState<Page>('calendar')
  const [selectedDate, setSelectedDate] = useState(toLocalDateKey(new Date()))
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [editingItem, setEditingItem] = useState<ScheduleItem | null>(null)
  const [creatingForDate, setCreatingForDate] = useState<string | null | undefined>(undefined)
  const [creatingForGoalId, setCreatingForGoalId] = useState<string | null>(null)
  const [editingGoal, setEditingGoal] = useState<Goal | null | undefined>(undefined)
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useTheme(snapshot.settings)

  useEffect(() => {
    if (!window.scheduleManager) {
      setError('应用服务加载失败，请重新启动应用')
      setLoading(false)
      return
    }
    window.scheduleManager.bootstrap()
      .then(setSnapshot)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '应用加载失败'))
      .finally(() => setLoading(false))
    return window.scheduleManager.onReminderOpen((itemId) => {
      void window.scheduleManager.bootstrap().then((fresh) => {
        setSnapshot(fresh)
        const item = fresh.items.find((candidate) => candidate.id === itemId)
        if (item?.scheduledDate) {
          setSelectedDate(item.scheduledDate)
          const date = parseDateKey(item.scheduledDate)
          setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1))
        }
        setPage('calendar')
        if (item) setEditingItem(item)
      })
    })
  }, [])

  const run = async (operation: () => Promise<AppSnapshot>): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await operation())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试')
      throw reason
    }
  }

  const openCreate = (date: string | null, goalId: string | null = null): void => {
    setEditingItem(null)
    setCreatingForDate(date)
    setCreatingForGoalId(goalId)
  }

  const navigate = (nextPage: Page): void => {
    setPage(nextPage)
    setRemindersOpen(false)
  }

  const openReminders = async (): Promise<void> => {
    setRemindersOpen((current) => !current)
    if (!remindersOpen && snapshot.reminders.some((reminder) => reminder.fired && !reminder.seen)) {
      await run(() => window.scheduleManager.markRemindersSeen())
    }
  }

  if (loading) return <div className="launch-screen"><div className="launch-mark"><CalendarDays /></div><p>正在整理你的日程…</p></div>

  const unreadCount = snapshot.reminders.filter((reminder) => reminder.fired && !reminder.seen).length

  return (
    <div className="app-shell">
      <Sidebar page={page} snapshot={snapshot} onNavigate={navigate} unreadCount={unreadCount} onReminders={openReminders} />
      <main className="main-area">
        <QuickAdd
          defaultDate={page === 'calendar' ? selectedDate : null}
          onAdd={(input) => run(() => window.scheduleManager.saveItem(input))}
          onExpand={() => openCreate(page === 'calendar' ? selectedDate : null)}
        />
        {page === 'calendar' && (
          <CalendarPage
            snapshot={snapshot}
            selectedDate={selectedDate}
            monthCursor={monthCursor}
            onMonthChange={setMonthCursor}
            onSelectDate={setSelectedDate}
            onEdit={setEditingItem}
            onCreate={() => openCreate(selectedDate)}
            onToggle={(id) => run(() => window.scheduleManager.toggleItem(id))}
          />
        )}
        {page === 'tasks' && <TasksPage snapshot={snapshot} onCreate={() => openCreate(null)} onEdit={setEditingItem} onToggle={(id) => run(() => window.scheduleManager.toggleItem(id))} />}
        {page === 'unscheduled' && <UnscheduledPage snapshot={snapshot} onCreate={() => openCreate(null)} onEdit={setEditingItem} onToggle={(id) => run(() => window.scheduleManager.toggleItem(id))} />}
        {page === 'goals' && <GoalsPage snapshot={snapshot} onCreate={() => setEditingGoal(null)} onEdit={setEditingGoal} onDelete={(id) => run(() => window.scheduleManager.deleteGoal(id))} onCreateTask={(goalId) => openCreate(null, goalId)} onEditTask={setEditingItem} onToggleTask={(id) => run(() => window.scheduleManager.toggleItem(id))} />}
        {page === 'history' && <HistoryPage snapshot={snapshot} onEdit={setEditingItem} onToggle={(id) => run(() => window.scheduleManager.toggleItem(id))} />}
        {page === 'settings' && (
          <SettingsPage
            settings={snapshot.settings}
            onSettings={(value) => run(() => window.scheduleManager.saveSettings(value))}
            onExport={async () => {
              const result = await window.scheduleManager.exportBackup()
              setNotice(result.success ? `备份已保存：${result.path}` : result.message ?? '未导出备份')
            }}
            onImport={async () => {
              const result = await window.scheduleManager.importBackup()
              setNotice(result.message ?? (result.success ? '恢复成功' : '未恢复备份'))
              if (result.success) setSnapshot(await window.scheduleManager.bootstrap())
            }}
          />
        )}
      </main>

      {remindersOpen && <ReminderPanel reminders={snapshot.reminders} items={snapshot.items} onClose={() => setRemindersOpen(false)} onOpen={(item) => {
        setEditingItem(item)
        setRemindersOpen(false)
      }} />}
      {(creatingForDate !== undefined || editingItem) && (
        <ItemEditor
          item={editingItem}
          defaultDate={creatingForDate ?? null}
          defaultGoalId={creatingForGoalId}
          snapshot={snapshot}
          onClose={() => { setEditingItem(null); setCreatingForDate(undefined); setCreatingForGoalId(null) }}
          onSave={async (input, scope) => {
            await run(() => window.scheduleManager.saveItem(input, scope))
            setEditingItem(null)
            setCreatingForDate(undefined)
            setCreatingForGoalId(null)
          }}
          onDelete={async (id, scope) => {
            await run(() => window.scheduleManager.deleteItem(id, scope))
            setEditingItem(null)
          }}
        />
      )}
      {editingGoal !== undefined && (
        <GoalEditor
          goal={editingGoal}
          onClose={() => setEditingGoal(undefined)}
          onSave={async (input) => {
            await run(() => window.scheduleManager.saveGoal(input))
            setEditingGoal(undefined)
          }}
        />
      )}
      {error && <Toast tone="error" onClose={() => setError(null)}>{error}</Toast>}
      {notice && <Toast onClose={() => setNotice(null)}>{notice}</Toast>}
    </div>
  )
}

function Sidebar({ page, snapshot, onNavigate, unreadCount, onReminders }: {
  page: Page
  snapshot: AppSnapshot
  onNavigate: (page: Page) => void
  unreadCount: number
  onReminders: () => void
}): ReactNode {
  const nav: Array<{ id: Page; label: string; icon: ReactNode; count?: number }> = [
    { id: 'calendar', label: '月历', icon: <CalendarDays size={18} /> },
    { id: 'tasks', label: '全部任务', icon: <ListTodo size={18} />, count: snapshot.items.filter((item) => item.status === 'pending').length },
    { id: 'unscheduled', label: '待安排', icon: <Inbox size={18} />, count: snapshot.items.filter((item) => !item.scheduledDate && item.status === 'pending').length },
    { id: 'goals', label: '目标', icon: <Target size={18} /> },
    { id: 'history', label: '完成历史', icon: <History size={18} /> }
  ]
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Check size={19} strokeWidth={2.6} /></span><div><strong>日程管理</strong><small>把每一步都记下来</small></div></div>
      <button className="reminder-button" onClick={onReminders}><Bell size={18} /><span>提醒中心</span>{unreadCount > 0 && <em>{unreadCount}</em>}</button>
      <nav className="primary-nav">
        <p className="nav-label">我的日程</p>
        {nav.map((entry) => (
          <button key={entry.id} className={page === entry.id ? 'active' : ''} onClick={() => onNavigate(entry.id)}>
            {entry.icon}<span>{entry.label}</span>{entry.count ? <em>{entry.count}</em> : null}
          </button>
        ))}
      </nav>
      <button className={`sidebar-settings ${page === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')}><Settings size={18} /><span>设置</span></button>
    </aside>
  )
}

function QuickAdd({ defaultDate, onAdd, onExpand }: {
  defaultDate: string | null
  onAdd: (input: ItemInput) => Promise<void>
  onExpand: () => void
}): ReactNode {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await onAdd({ title, scheduledDate: defaultDate })
      setTitle('')
    } finally { setSaving(false) }
  }
  return (
    <header className="topbar">
      <form className="quick-add" onSubmit={submit}>
        <Plus size={19} />
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={defaultDate ? `添加 ${formatDate(defaultDate, false)} 的任务…` : '快速添加一个任务…'} />
        <span>{saving ? '保存中' : '回车保存'}</span>
      </form>
      <button className="icon-button" title="打开完整编辑器" onClick={onExpand}><MoreHorizontal size={20} /></button>
    </header>
  )
}

function CalendarPage({ snapshot, selectedDate, monthCursor, onMonthChange, onSelectDate, onEdit, onCreate, onToggle }: {
  snapshot: AppSnapshot
  selectedDate: string
  monthCursor: Date
  onMonthChange: (date: Date) => void
  onSelectDate: (date: string) => void
  onEdit: (item: ScheduleItem) => void
  onCreate: () => void
  onToggle: (id: string) => Promise<void>
}): ReactNode {
  const days = calendarDays(monthCursor)
  const today = toLocalDateKey(new Date())
  const itemsByDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>()
    snapshot.items.forEach((item) => {
      if (!item.scheduledDate) return
      const current = map.get(item.scheduledDate) ?? []
      current.push(item)
      map.set(item.scheduledDate, current)
    })
    map.forEach((items) => items.sort(itemSort))
    return map
  }, [snapshot.items])
  const selectedItems = itemsByDate.get(selectedDate) ?? []
  const shiftMonth = (amount: number): void => onMonthChange(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + amount, 1))
  return (
    <section className="calendar-layout">
      <div className="calendar-main">
        <div className="page-toolbar">
          <div><h1>{monthTitle(monthCursor)}</h1><p>{snapshot.items.filter((item) => item.status === 'pending' && item.scheduledDate?.startsWith(`${monthCursor.getFullYear()}-${pad(monthCursor.getMonth() + 1)}`)).length} 项待完成</p></div>
          <div className="toolbar-actions"><button className="soft-button" onClick={() => onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>今天</button><button className="icon-button" onClick={() => shiftMonth(-1)}><ChevronLeft size={20} /></button><button className="icon-button" onClick={() => shiftMonth(1)}><ChevronRight size={20} /></button></div>
        </div>
        <div className="calendar-grid week-header">{WEEKDAYS.map((day) => <div key={day}>周{day}</div>)}</div>
        <div className="calendar-grid month-grid">
          {days.map((date) => {
            const dateObject = parseDateKey(date)
            const outside = dateObject.getMonth() !== monthCursor.getMonth()
            const dayItems = itemsByDate.get(date) ?? []
            return (
              <button key={date} className={`day-cell ${outside ? 'outside' : ''} ${selectedDate === date ? 'selected' : ''}`} onClick={() => onSelectDate(date)}>
                <span className={`day-number ${today === date ? 'today' : ''}`}>{dateObject.getDate()}</span>
                <div className="cell-items">
                  {dayItems.slice(0, 3).map((item) => <span key={item.id} className={`cell-item priority-${item.priority} ${item.status}`}><i />{item.startTime && <b>{item.startTime}</b>}{item.title}</span>)}
                  {dayItems.length > 3 && <small>还有 {dayItems.length - 3} 项</small>}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <DayPanel date={selectedDate} items={selectedItems} goals={snapshot.goals} onEdit={onEdit} onCreate={onCreate} onToggle={onToggle} />
    </section>
  )
}

function DayPanel({ date, items, goals, onEdit, onCreate, onToggle }: {
  date: string
  items: ScheduleItem[]
  goals: Goal[]
  onEdit: (item: ScheduleItem) => void
  onCreate: () => void
  onToggle: (id: string) => Promise<void>
}): ReactNode {
  const pending = items.filter((item) => item.status === 'pending').length
  return (
    <aside className="day-panel">
      <div className="day-panel-heading"><div><span>{formatDate(date)}</span><h2>{pending ? `${pending} 项待完成` : '这一天很轻松'}</h2></div><button className="round-add" onClick={onCreate}><Plus size={19} /></button></div>
      <div className="day-items">
        {items.length ? items.map((item) => <ItemCard key={item.id} item={item} goal={goals.find((goal) => goal.id === item.goalId)} onEdit={() => onEdit(item)} onToggle={() => onToggle(item.id)} />) : <EmptyState icon={<Sun />} title="暂无安排" description="给这一天留点空白，或添加下一件想做的事。" action="添加任务" onAction={onCreate} />}
      </div>
    </aside>
  )
}

function ItemCard({ item, goal, onEdit, onToggle }: { item: ScheduleItem; goal?: Goal; onEdit: () => void; onToggle: () => void }): ReactNode {
  const overdue = isOverdue(item)
  return (
    <article className={`item-card ${item.status} ${overdue ? 'overdue' : ''}`} onDoubleClick={onEdit}>
      <button className="check-button" onClick={onToggle} aria-label={item.status === 'completed' ? '重新打开' : '完成事项'}>{item.status === 'completed' ? <Check size={15} /> : <Circle size={17} />}</button>
      <div className="item-content" onClick={onEdit}>
        <div className="item-title-row"><h3>{item.title}</h3>{item.recurrenceRule !== 'none' && <RotateCcw size={13} />}</div>
        <div className="item-meta">
          {item.scheduledDate && <span><CalendarDays size={12} />{formatDate(item.scheduledDate, false)}</span>}
          {item.startTime && <span><Clock3 size={12} />{item.startTime}{item.endTime ? `–${item.endTime}` : ''}</span>}
          {goal && <span><Target size={12} />{goal.name}</span>}
          {overdue && <span className="danger">已逾期</span>}
        </div>
      </div>
      <button className="more-button" onClick={onEdit}><MoreHorizontal size={17} /></button>
    </article>
  )
}

function TasksPage({ snapshot, onCreate, onEdit, onToggle }: {
  snapshot: AppSnapshot
  onCreate: () => void
  onEdit: (item: ScheduleItem) => void
  onToggle: (id: string) => Promise<void>
}): ReactNode {
  const [goalFilter, setGoalFilter] = useState('all')
  const [query, setQuery] = useState('')
  const items = snapshot.items.filter((item) => item.status === 'pending')
    .filter((item) => goalFilter === 'all' || (goalFilter === 'none' ? !item.goalId : item.goalId === goalFilter))
    .filter((item) => !query || `${item.title} ${item.notes}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (a.scheduledDate ?? '9999-12-31').localeCompare(b.scheduledDate ?? '9999-12-31') || itemSort(a, b))
  return (
    <PageFrame title="全部任务" subtitle="任务是具体行动；可以服务于某个目标，也可以独立存在。" action={<button className="primary-button" onClick={onCreate}><Plus size={17} />新建任务</button>}>
      <div className="filter-bar">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" /></label>
        <select value={goalFilter} onChange={(event) => setGoalFilter(event.target.value)}><option value="all">全部目标</option><option value="none">未关联目标</option>{snapshot.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select>
      </div>
      <div className="content-card item-list-card">
        {items.length ? items.map((item) => <ItemCard key={item.id} item={item} goal={snapshot.goals.find((goal) => goal.id === item.goalId)} onEdit={() => onEdit(item)} onToggle={() => onToggle(item.id)} />) : <EmptyState icon={<ListTodo />} title="没有符合条件的任务" description="创建一个独立任务，或为某个目标添加行动。" action="新建任务" onAction={onCreate} />}
      </div>
    </PageFrame>
  )
}

function UnscheduledPage({ snapshot, onCreate, onEdit, onToggle }: {
  snapshot: AppSnapshot
  onCreate: () => void
  onEdit: (item: ScheduleItem) => void
  onToggle: (id: string) => Promise<void>
}): ReactNode {
  const items = snapshot.items.filter((item) => !item.scheduledDate && item.status === 'pending').sort(itemSort)
  return (
    <PageFrame title="待安排" subtitle="这里是还没确定日期的任务，安排好时间后会进入日历。" action={<button className="primary-button" onClick={onCreate}><Plus size={17} />添加任务</button>}>
      <div className="content-card item-list-card">
        {items.length ? items.map((item) => <ItemCard key={item.id} item={item} goal={snapshot.goals.find((goal) => goal.id === item.goalId)} onEdit={() => onEdit(item)} onToggle={() => onToggle(item.id)} />) : <EmptyState icon={<Inbox />} title="没有待安排的任务" description="所有任务都已经安排好日期，或者暂时没有新任务。" action="添加任务" onAction={onCreate} />}
      </div>
    </PageFrame>
  )
}

function GoalsPage({ snapshot, onCreate, onEdit, onDelete, onCreateTask, onEditTask, onToggleTask }: {
  snapshot: AppSnapshot
  onCreate: () => void
  onEdit: (goal: Goal) => void
  onDelete: (id: string) => Promise<void>
  onCreateTask: (goalId: string) => void
  onEditTask: (item: ScheduleItem) => void
  onToggleTask: (id: string) => Promise<void>
}): ReactNode {
  return (
    <PageFrame title="目标" subtitle="目标描述想达成的结果，关联任务描述为它采取的行动。" action={<button className="primary-button" onClick={onCreate}><Plus size={17} />新建目标</button>}>
      {snapshot.goals.length ? <div className="goal-grid">{snapshot.goals.map((goal) => {
        const tasks = snapshot.items.filter((item) => item.goalId === goal.id).sort(itemSort)
        return (
        <article className="goal-card" key={goal.id}>
          <div className="goal-card-top"><span className={`status-pill status-${goal.status}`}>{GOAL_STATUS_LABEL[goal.status]}</span><div><button className="more-button" onClick={() => onEdit(goal)}><MoreHorizontal size={18} /></button><button className="more-button danger-button" onClick={() => { if (window.confirm(`确定删除目标“${goal.name}”吗？关联任务不会被删除，只会解除关联。`)) void onDelete(goal.id) }}><Trash2 size={16} /></button></div></div>
          <h2>{goal.name}</h2><p>{goal.description || '还没有目标说明'}</p>
          <div className="goal-progress-label"><span>{goal.completedItemCount}/{goal.itemCount} 个任务已完成</span><strong>{goal.progress}%</strong></div><div className="progress-track"><i style={{ width: `${goal.progress}%` }} /></div>
          <div className="goal-task-list">
            {tasks.slice(0, 5).map((item) => <ItemCard key={item.id} item={item} onEdit={() => onEditTask(item)} onToggle={() => onToggleTask(item.id)} />)}
            {!tasks.length && <p className="muted-line">还没有为这个目标设置任务</p>}
            {tasks.length > 5 && <p className="muted-line">还有 {tasks.length - 5} 个任务</p>}
          </div>
          <div className="goal-card-footer"><div className="goal-dates"><CalendarDays size={14} />{goal.startDate ? formatDate(goal.startDate, false) : '未设置开始'} — {goal.endDate ? formatDate(goal.endDate, false) : '未设置结束'}</div><button className="soft-button small" onClick={() => onCreateTask(goal.id)}><Plus size={14} />添加任务</button></div>
        </article>
      )})}</div> : <div className="content-card"><EmptyState icon={<Target />} title="建立第一个目标" description="目标可以独立存在，也可以通过关联任务自动计算进度。" action="新建目标" onAction={onCreate} /></div>}
    </PageFrame>
  )
}

function HistoryPage({ snapshot, onEdit, onToggle }: { snapshot: AppSnapshot; onEdit: (item: ScheduleItem) => void; onToggle: (id: string) => Promise<void> }): ReactNode {
  const [query, setQuery] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [goalId, setGoalId] = useState('')
  const groups = useMemo(() => {
    const filtered = snapshot.items.filter((item) => {
      if (item.status !== 'completed' || !item.completedAt) return false
      const completedDate = toLocalDateKey(new Date(item.completedAt))
      return (!query || `${item.title} ${item.notes}`.toLowerCase().includes(query.toLowerCase()))
        && (!startDate || completedDate >= startDate)
        && (!endDate || completedDate <= endDate)
        && (!goalId || (goalId === 'none' ? !item.goalId : item.goalId === goalId))
    }).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    const map = new Map<string, ScheduleItem[]>()
    filtered.forEach((item) => {
      const key = toLocalDateKey(new Date(item.completedAt!))
      map.set(key, [...(map.get(key) ?? []), item])
    })
    return [...map.entries()]
  }, [snapshot, query, startDate, endDate, goalId])
  return (
    <PageFrame title="完成历史" subtitle="回头看看，你已经往前走了多远。">
      <div className="filter-bar">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索完成记录" /></label>
        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} title="开始日期" />
        <span>至</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} title="结束日期" />
        <select value={goalId} onChange={(event) => setGoalId(event.target.value)}><option value="">全部目标</option><option value="none">未关联目标</option>{snapshot.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select>
      </div>
      <div className="history-timeline">
        {groups.map(([date, items]) => <section className="history-group" key={date}><div className="history-date"><span>{parseDateKey(date).getDate()}</span><div><strong>{new Intl.DateTimeFormat('zh-CN', { month: 'long' }).format(parseDateKey(date))}</strong><small>{new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(parseDateKey(date))}</small></div></div><div className="history-items">{items.map((item) => <ItemCard key={item.id} item={item} goal={snapshot.goals.find((goal) => goal.id === item.goalId)} onEdit={() => onEdit(item)} onToggle={() => onToggle(item.id)} />)}</div></section>)}
        {!groups.length && <div className="content-card"><EmptyState icon={<History />} title="没有符合条件的记录" description="完成任务后，它会按实际完成日期出现在这里。" /></div>}
      </div>
    </PageFrame>
  )
}

function SettingsPage({ settings, onSettings, onExport, onImport }: {
  settings: AppSettings
  onSettings: (settings: Partial<AppSettings>) => Promise<void>
  onExport: () => Promise<void>
  onImport: () => Promise<void>
}): ReactNode {
  return (
    <PageFrame title="设置" subtitle="调整外观、提醒和本地数据。">
      <div className="settings-stack">
        <section className="content-card settings-section"><div className="settings-copy"><span className="setting-icon"><Moon /></span><div><h2>外观主题</h2><p>跟随 Windows，或者始终使用浅色、深色主题。</p></div></div><div className="segmented">{(['system', 'light', 'dark'] as const).map((theme) => <button key={theme} className={settings.theme === theme ? 'active' : ''} onClick={() => onSettings({ theme })}>{theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}</button>)}</div></section>
        <section className="content-card settings-section"><div className="settings-copy"><span className="setting-icon"><Bell /></span><div><h2>Windows 通知</h2><p>应用运行期间，在提醒时间弹出系统通知。</p></div></div><label className="switch"><input type="checkbox" checked={settings.notificationsEnabled} onChange={(event) => onSettings({ notificationsEnabled: event.target.checked })} /><span /></label></section>
        <section className="content-card settings-section backup-section"><div className="settings-copy"><span className="setting-icon"><Archive /></span><div><h2>本地备份</h2><p>导出所有事项、目标和设置。恢复前会自动创建安全备份。</p></div></div><div className="button-row"><button className="soft-button" onClick={onExport}><Download size={16} />导出备份</button><button className="soft-button" onClick={() => { if (window.confirm('恢复备份会替换当前数据，是否继续？')) void onImport() }}><Upload size={16} />恢复备份</button></div></section>
        <section className="about-line"><strong>日程管理</strong><span>版本 0.2.0 · 数据仅保存在本机</span></section>
      </div>
    </PageFrame>
  )
}

function ItemEditor({ item, defaultDate, defaultGoalId, snapshot, onClose, onSave, onDelete }: {
  item: ScheduleItem | null
  defaultDate: string | null
  defaultGoalId: string | null
  snapshot: AppSnapshot
  onClose: () => void
  onSave: (input: ItemInput, scope: RecurrenceScope) => Promise<void>
  onDelete: (id: string, scope: RecurrenceScope) => Promise<void>
}): ReactNode {
  const [title, setTitle] = useState(item?.title ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [scheduledDate, setScheduledDate] = useState(item?.scheduledDate ?? defaultDate ?? '')
  const [startTime, setStartTime] = useState(item?.startTime ?? '')
  const [endTime, setEndTime] = useState(item?.endTime ?? '')
  const [deadlineAt, setDeadlineAt] = useState(toDateTimeLocal(item?.deadlineAt ?? null))
  const [priority, setPriority] = useState(item?.priority ?? 'none')
  const [goalId, setGoalId] = useState(item?.goalId ?? defaultGoalId ?? '')
  const [reminderMinutes, setReminderMinutes] = useState(item?.reminderMinutes?.toString() ?? '')
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>(item?.recurrenceRule ?? 'none')
  const [scope, setScope] = useState<RecurrenceScope>('current')
  const [saving, setSaving] = useState(false)
  const recurring = Boolean(item?.recurrenceSeriesId)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSave({
        id: item?.id, title, notes, scheduledDate: scheduledDate || null, startTime: startTime || null,
        endTime: endTime || null, deadlineAt: deadlineAt || null, priority, goalId: goalId || null,
        reminderMinutes: reminderMinutes === '' ? null : Number(reminderMinutes), recurrenceRule
      }, scope)
    } finally { setSaving(false) }
  }
  return (
    <Modal title={item ? '编辑任务' : '新建任务'} onClose={onClose} wide>
      <form className="editor-form" onSubmit={submit}>
        <label className="field full"><span>标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="准备做什么？" required /></label>
        <label className="field full"><span>备注</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="补充一些背景、步骤或想法…" rows={3} /></label>
        <div className="form-grid">
          <label className="field"><span>计划日期</span><input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /></label>
          <label className="field"><span>关联目标</span><select value={goalId} onChange={(event) => setGoalId(event.target.value)}><option value="">独立任务，不关联目标</option>{snapshot.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select></label>
          <label className="field"><span>开始时间</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
          <label className="field"><span>结束时间</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
          <label className="field"><span>截止时间</span><input type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} /></label>
          <label className="field"><span>优先级</span><select value={priority} onChange={(event) => setPriority(event.target.value as ScheduleItem['priority'])}>{Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>提前提醒</span><select value={reminderMinutes} onChange={(event) => setReminderMinutes(event.target.value)}><option value="">不提醒</option><option value="0">准时</option><option value="10">提前 10 分钟</option><option value="30">提前 30 分钟</option><option value="60">提前 1 小时</option><option value="1440">提前 1 天</option></select></label>
          <label className="field"><span>重复</span><select value={recurrenceRule} onChange={(event) => setRecurrenceRule(event.target.value as RecurrenceRule)} disabled={!scheduledDate}><option value="none">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
        </div>
        {recurring && <label className="scope-picker"><span>本次修改作用于</span><select value={scope} onChange={(event) => setScope(event.target.value as RecurrenceScope)}><option value="current">仅本次</option><option value="future">本次及以后</option></select></label>}
        <div className="modal-footer">
          <div>{item && <button type="button" className="text-danger" onClick={() => { if (window.confirm(`确定删除“${item.title}”吗？`)) void onDelete(item.id, scope) }}><Trash2 size={16} />删除</button>}</div>
          <div className="button-row"><button type="button" className="soft-button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={!title.trim() || saving}>{saving ? '保存中…' : '保存任务'}</button></div>
        </div>
      </form>
    </Modal>
  )
}

function GoalEditor({ goal, onClose, onSave }: { goal: Goal | null; onClose: () => void; onSave: (input: GoalInput) => Promise<void> }): ReactNode {
  const [name, setName] = useState(goal?.name ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [startDate, setStartDate] = useState(goal?.startDate ?? '')
  const [endDate, setEndDate] = useState(goal?.endDate ?? '')
  const [status, setStatus] = useState<Goal['status']>(goal?.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ id: goal?.id, name, description, startDate: startDate || null, endDate: endDate || null, status })
    } finally { setSaving(false) }
  }
  return (
    <Modal title={goal ? '编辑目标' : '新建目标'} onClose={onClose} wide>
      <form className="editor-form" onSubmit={submit}>
        <label className="field full"><span>目标名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：完成个人作品集" required /></label>
        <label className="field full"><span>目标说明</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="为什么要完成它，期待达到什么结果？" /></label>
        <div className="form-grid three"><label className="field"><span>开始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="field"><span>结束日期</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label className="field"><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as Goal['status'])}>{Object.entries(GOAL_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <div className="modal-footer"><span /><div className="button-row"><button type="button" className="soft-button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={!name.trim() || saving}>{saving ? '保存中…' : '保存目标'}</button></div></div>
      </form>
    </Modal>
  )
}

function ReminderPanel({ reminders, items, onClose, onOpen }: { reminders: AppSnapshot['reminders']; items: ScheduleItem[]; onClose: () => void; onOpen: (item: ScheduleItem) => void }): ReactNode {
  return <div className="reminder-panel"><div className="panel-title"><div><Bell size={18} /><h2>提醒中心</h2></div><button className="more-button" onClick={onClose}><X size={18} /></button></div><div className="reminder-list">{reminders.length ? reminders.map((reminder) => { const item = items.find((candidate) => candidate.id === reminder.itemId); return <button key={reminder.id} className={reminder.fired ? 'fired' : ''} onClick={() => item && onOpen(item)}><span className="reminder-icon"><Clock3 size={16} /></span><div><strong>{reminder.itemTitle}</strong><small>{reminder.fired ? '提醒时间已到' : formatDateTime(reminder.triggerAt)}</small></div>{!reminder.seen && reminder.fired && <i />}</button> }) : <EmptyState icon={<Bell />} title="没有提醒" description="带提醒的近期任务会显示在这里。" />}</div></div>
}

function PageFrame({ title, subtitle, action, children }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode }): ReactNode {
  return <section className="page-scroll"><div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>{children}</section>
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }): ReactNode {
  useEffect(() => {
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`modal ${wide ? 'wide' : ''}`}><header><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={19} /></button></header>{children}</section></div>
}

function EmptyState({ icon, title, description, action, onAction }: { icon: ReactNode; title: string; description: string; action?: string; onAction?: () => void }): ReactNode {
  return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{description}</p>{action && onAction && <button className="soft-button" onClick={onAction}><Plus size={15} />{action}</button>}</div>
}

function Toast({ tone, children, onClose }: { tone?: 'error'; children: ReactNode; onClose: () => void }): ReactNode {
  useEffect(() => { const timer = window.setTimeout(onClose, 5000); return () => window.clearTimeout(timer) }, [onClose])
  return <div className={`toast ${tone ?? ''}`}><span>{children}</span><button onClick={onClose}><X size={16} /></button></div>
}
