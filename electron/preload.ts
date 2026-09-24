import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, GoalInput, ItemInput, RecurrenceScope, SchedulerAPI } from '../src/shared/types'

const api: SchedulerAPI = {
  bootstrap: () => ipcRenderer.invoke('schedule:bootstrap'),
  saveItem: (input: ItemInput, scope?: RecurrenceScope) => ipcRenderer.invoke('schedule:save-item', input, scope),
  toggleItem: (id: string) => ipcRenderer.invoke('schedule:toggle-item', id),
  deleteItem: (id: string, scope?: RecurrenceScope) => ipcRenderer.invoke('schedule:delete-item', id, scope),
  saveList: (input) => ipcRenderer.invoke('schedule:save-list', input),
  deleteList: (id: string) => ipcRenderer.invoke('schedule:delete-list', id),
  saveGoal: (input: GoalInput) => ipcRenderer.invoke('schedule:save-goal', input),
  deleteGoal: (id: string) => ipcRenderer.invoke('schedule:delete-goal', id),
  markRemindersSeen: () => ipcRenderer.invoke('schedule:mark-reminders-seen'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('schedule:save-settings', settings),
  exportBackup: () => ipcRenderer.invoke('schedule:export-backup'),
  importBackup: () => ipcRenderer.invoke('schedule:import-backup'),
  onReminderOpen: (callback: (itemId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, itemId: string): void => callback(itemId)
    ipcRenderer.on('schedule:reminder-open', listener)
    return () => ipcRenderer.removeListener('schedule:reminder-open', listener)
  }
}

contextBridge.exposeInMainWorld('scheduleManager', api)
