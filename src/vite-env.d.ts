/// <reference types="vite/client" />

import type { SchedulerAPI } from './shared/types'

declare global {
  interface Window {
    scheduleManager: SchedulerAPI
  }
}

export {}
