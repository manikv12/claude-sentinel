import { create } from 'zustand'

export interface UsageData {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  model: string
  // Number of unique sessions for this day
  sessionsCount?: number
}

export interface CurrentBlock {
  timeRemaining: number | null
  usage: number
  limit: number
  startTime: string | null
  endTime: string | null
  isActive: boolean
  cost?: number
}

export interface UsagePrediction {
  tokensPerMinute: number
  estimatedLimitReached: Date | null
  minutesUntilLimit: number | null
  warningLevel: 'none' | 'moderate' | 'high' | 'critical'
}

export interface UsageSummary {
  totalCost: number
  totalTokens: number
  totalSessions: number
  averageTokensPerSession: number
}

interface UsageStore {
  usageData: {
    daily: UsageData[]
    monthly: UsageData[]
    sessions: UsageData[]
    blocks: UsageData[]
  }
  summary: UsageSummary
  currentBlock: CurrentBlock | null
  isLoading: boolean
  error: string | null
  // Individual component loading states
  loadingStates: {
    summary: boolean
    currentBlock: boolean
    chart: boolean
  }
  
  setUsageData: (data: any) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setComponentLoading: (component: keyof UsageStore['loadingStates'], loading: boolean) => void
  loadDataInBackground: () => void
  refreshData: () => Promise<void>
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  usageData: {
    daily: [],
    monthly: [],
    sessions: [],
    blocks: []
  },
  summary: {
    totalCost: 0,
    totalTokens: 0,
    totalSessions: 0,
    averageTokensPerSession: 0
  },
  currentBlock: null,
  isLoading: false,
  error: null,
  loadingStates: {
    summary: false,
    currentBlock: false,
    chart: false
  },

  setUsageData: (data) => {
    const summary = calculateSummary(data.daily || [])
    set({ 
      usageData: data, 
      summary, 
      currentBlock: data.currentBlock || null, 
      error: null,
      loadingStates: { summary: false, currentBlock: false, chart: false }
    })
  },

  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),

  setComponentLoading: (component, loading) => set((state) => ({
    loadingStates: { ...state.loadingStates, [component]: loading }
  })),

  loadDataInBackground: () => {
    // Start loading in background without blocking UI
    const { setComponentLoading, setUsageData, setError } = get()
    
    // Set all components as loading
    setComponentLoading('summary', true)
    setComponentLoading('currentBlock', true)
    setComponentLoading('chart', true)

    // Load data asynchronously
    const loadAsync = async () => {
      try {
        if (!window.electronAPI?.hardRefreshUsageData) {
          console.warn('Running in development mode - Electron API not available')
          return
        }

        const data = await Promise.race([
          window.electronAPI.hardRefreshUsageData(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 5000))
        ])

        setUsageData(data)
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load usage data')
        // Clear loading states on error
        setComponentLoading('summary', false)
        setComponentLoading('currentBlock', false)
        setComponentLoading('chart', false)
      }
    }

    // Run in background without awaiting
    loadAsync()
  },

  // Fast initial load using cached data
  loadCachedData: async () => {
    set({ isLoading: true, error: null })
    try {
      if (!window.electronAPI?.getUsageData) {
        console.warn('Running in development mode - Electron API not available')
        set({ isLoading: false })
        return
      }

      // Fast cached data load with short timeout
      const data = await Promise.race([
        window.electronAPI.getUsageData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Cache timeout')), 2000))
      ])

      get().setUsageData(data)
    } catch (error) {
      console.warn('Cache load failed, will use hard refresh:', error)
      // Don't set error state for cache failures
    } finally {
      set({ isLoading: false })
    }
  },

  refreshData: async () => {
    set({ isLoading: true, error: null })
    try {
      if (!window.electronAPI?.hardRefreshUsageData) {
        console.warn('Running in development mode - Electron API not available')
        set({ isLoading: false })
        return
      }

      // Reduced timeout for better UX
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 5000) // 5 second timeout
      })

      // Always use hardRefreshUsageData to ensure we get current plan limits
      const data = await Promise.race([
        window.electronAPI.hardRefreshUsageData(),
        timeoutPromise
      ])

      get().setUsageData(data)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to load usage data' })
    } finally {
      set({ isLoading: false })
    }
  }
}))

function calculateSummary(dailyData: UsageData[]): UsageSummary {
  if (!dailyData || dailyData.length === 0) {
    return { totalCost: 0, totalTokens: 0, totalSessions: 0, averageTokensPerSession: 0 }
  }

  // Compute summary for the most recent day only (dashboard should be daily)
  const latest = [...dailyData].sort((a, b) => a.date.localeCompare(b.date)).pop()!
  const totalCost = latest.cost
  const totalTokens = latest.totalTokens
  const totalSessions = latest.sessionsCount ?? 0
  const averageTokensPerSession = totalSessions > 0 ? totalTokens / totalSessions : 0

  return {
    totalCost,
    totalTokens,
    totalSessions,
    averageTokensPerSession
  }
}
