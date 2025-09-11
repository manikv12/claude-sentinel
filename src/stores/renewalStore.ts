import { create } from 'zustand'

export interface RenewalStatus {
  enabled: boolean
  nextRenewal: Date | null
  lastActivity: Date | null
  timeRemaining: number | null // minutes until reset
  scheduledStartTime: string | null // ISO string for scheduled start
  currentBlock: {
    startTime: Date | null
    endTime: Date | null
    usage: number // tokens used in current block
    limit: number // token limit for block
  } | null
}

interface RenewalStore {
  status: RenewalStatus
  isLoading: boolean
  error: string | null
  settings: {
    checkInterval: number
    enableLogging: boolean
    notifyOnRenewal: boolean
    waitTimeBeforeSession: number
    autoRefresh: boolean
    autoRefreshInterval: number
  }
  
  setRenewalStatus: (status: any) => void
  toggleAutoRenewal: (enabled: boolean, scheduledTime?: string) => Promise<void>
  updateSettings: (settings: Partial<RenewalStore['settings']>) => void
  setScheduledStartTime: (time: string | null) => Promise<void>
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  refreshStatus: () => Promise<void>
}

export const useRenewalStore = create<RenewalStore>((set, get) => ({
  status: {
    enabled: false,
    nextRenewal: null,
    lastActivity: null,
    timeRemaining: null,
    scheduledStartTime: null,
    currentBlock: null
  },
  isLoading: false,
  error: null,
  settings: {
    checkInterval: 5,
    enableLogging: true,
    notifyOnRenewal: true,
    waitTimeBeforeSession: 60,
    autoRefresh: false,
    autoRefreshInterval: 120
  },

  setRenewalStatus: (status) => {
    const processedStatus: RenewalStatus = {
      enabled: status.enabled,
      nextRenewal: status.nextRenewal ? new Date(status.nextRenewal) : null,
      lastActivity: status.lastActivity ? new Date(status.lastActivity) : null,
      timeRemaining: status.timeRemaining,
      scheduledStartTime: status.scheduledStartTime || null,
      currentBlock: status.currentBlock ? {
        startTime: status.currentBlock.startTime ? new Date(status.currentBlock.startTime) : null,
        endTime: status.currentBlock.endTime ? new Date(status.currentBlock.endTime) : null,
        usage: status.currentBlock.usage || 0,
        limit: status.currentBlock.limit || 0
      } : null
    }
    set({ status: processedStatus, error: null })
  },

  toggleAutoRenewal: async (enabled, scheduledTime) => {
    set({ isLoading: true, error: null })
    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 10000) // 10 second timeout
      })
      
      const result = await Promise.race([
        window.electronAPI.toggleAutoRenewal(enabled, scheduledTime),
        timeoutPromise
      ])
      
      if (result && result.success) {
        set(state => ({
          status: { 
            ...state.status, 
            enabled: result.enabled,
            scheduledStartTime: scheduledTime || null
          },
          isLoading: false
        }))
      } else {
        throw new Error(result?.error || 'Failed to toggle auto-renewal')
      }
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to toggle auto-renewal',
        isLoading: false 
      })
    }
  },

  updateSettings: (newSettings) => {
    set(state => ({
      settings: { ...state.settings, ...newSettings }
    }))
  },

  setScheduledStartTime: async (time) => {
    set({ isLoading: true, error: null })
    try {
      await window.electronAPI.setScheduledStartTime?.(time)
      set(state => ({
        status: { ...state.status, scheduledStartTime: time },
        isLoading: false
      }))
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to set scheduled time',
        isLoading: false 
      })
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),

  refreshStatus: async () => {
    set({ isLoading: true, error: null })
    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 8000) // 8 second timeout
      })
      
      const status = await Promise.race([
        window.electronAPI.getRenewalStatus(),
        timeoutPromise
      ])
      
      get().setRenewalStatus(status)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to load renewal status' })
    } finally {
      set({ isLoading: false })
    }
  }
}))