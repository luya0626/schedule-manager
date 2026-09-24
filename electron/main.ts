import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, nativeTheme } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ScheduleDatabase } from './database'
import type { AppSettings, GoalInput, ItemInput, RecurrenceScope } from '../src/shared/types'

let mainWindow: BrowserWindow | null = null
let database: ScheduleDatabase | null = null
let reminderTimer: NodeJS.Timeout | null = null

function getDatabase(): ScheduleDatabase {
  if (!database) throw new Error('数据库尚未初始化')
  return database
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: '日程管理',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171a1a' : '#f4f3ef',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('schedule:bootstrap', () => getDatabase().snapshot())
  ipcMain.handle('schedule:save-item', (_event, input: ItemInput, scope?: RecurrenceScope) => getDatabase().saveItem(input, scope))
  ipcMain.handle('schedule:toggle-item', (_event, id: string) => getDatabase().toggleItem(id))
  ipcMain.handle('schedule:delete-item', (_event, id: string, scope?: RecurrenceScope) => getDatabase().deleteItem(id, scope))
  ipcMain.handle('schedule:save-list', (_event, input: { id?: string; name: string; color: string }) => getDatabase().saveList(input))
  ipcMain.handle('schedule:delete-list', (_event, id: string) => getDatabase().deleteList(id))
  ipcMain.handle('schedule:save-goal', (_event, input: GoalInput) => getDatabase().saveGoal(input))
  ipcMain.handle('schedule:delete-goal', (_event, id: string) => getDatabase().deleteGoal(id))
  ipcMain.handle('schedule:mark-reminders-seen', () => getDatabase().markRemindersSeen())
  ipcMain.handle('schedule:save-settings', (_event, settings: Partial<AppSettings>) => {
    if (settings.theme) nativeTheme.themeSource = settings.theme
    return getDatabase().saveSettings(settings)
  })
  ipcMain.handle('schedule:export-backup', exportBackup)
  ipcMain.handle('schedule:import-backup', importBackup)
}

async function exportBackup(): Promise<{ success: boolean; path?: string; message?: string }> {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '导出日程备份',
    defaultPath: `日程管理备份-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: '日程管理备份', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { success: false, message: '已取消导出' }
  try {
    await writeFile(result.filePath, JSON.stringify(getDatabase().exportBackup(), null, 2), 'utf8')
    return { success: true, path: result.filePath }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '导出失败' }
  }
}

async function importBackup(): Promise<{ success: boolean; path?: string; message?: string }> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '恢复日程备份',
    properties: ['openFile'],
    filters: [{ name: '日程管理备份', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePaths[0]) return { success: false, message: '已取消恢复' }
  try {
    const backupDirectory = join(app.getPath('userData'), 'backups')
    await mkdir(backupDirectory, { recursive: true })
    const safetyPath = join(backupDirectory, `恢复前备份-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    await writeFile(safetyPath, JSON.stringify(getDatabase().exportBackup(), null, 2), 'utf8')
    const raw = await readFile(result.filePaths[0], 'utf8')
    getDatabase().importBackup(JSON.parse(raw) as unknown)
    return { success: true, path: result.filePaths[0], message: `恢复成功。恢复前数据已保存到 ${safetyPath}` }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '恢复失败' }
  }
}

function startReminderScheduler(): void {
  const db = getDatabase()
  db.markPastRemindersAsMissed()
  const check = (): void => {
    const settings = db.snapshot().settings
    for (const reminder of db.dueReminders()) {
      db.markReminderFired(reminder.id)
      if (!settings.notificationsEnabled || !Notification.isSupported()) continue
      const notification = new Notification({
        title: '日程提醒',
        body: reminder.title,
        silent: false
      })
      notification.on('click', () => {
        if (!mainWindow) createWindow()
        mainWindow?.show()
        mainWindow?.focus()
        mainWindow?.webContents.send('schedule:reminder-open', reminder.itemId)
      })
      notification.show()
    }
  }
  reminderTimer = setInterval(check, 30_000)
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.local.schedulemanager')
  Menu.setApplicationMenu(null)
  database = new ScheduleDatabase(join(app.getPath('userData'), 'schedule-manager.sqlite'))
  nativeTheme.themeSource = database.snapshot().settings.theme
  registerIpc()
  createWindow()
  startReminderScheduler()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (reminderTimer) clearInterval(reminderTimer)
  database?.close()
})
