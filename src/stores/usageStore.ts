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
  setPartialUsageData: (data: any) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setComponentLoading: (component: keyof UsageStore['loadingStates'], loading: boolean) => void
  loadDataInBackground: () => void
  loadCachedData: () => Promise<void>
  refreshData: () => Promise<void>
  loadDataForDays: (days: number) => Promise<void>
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
    summary: true,  // Start with skeletons visible
    currentBlock: true,
    chart: true
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

  // Handle partial updates from progressive loading
  setPartialUsageData: (data) => {
    const summary = calculateSummary(data.daily || [])
    // For partial updates, only clear loading states if we have meaningful data
    const hasData = data.daily && data.daily.length > 0
    set({ 
      usageData: data, 
      summary, 
      currentBlock: data.currentBlock || null, 
      error: null,
      // Keep some loading states active if this is just partial cached data
      loadingStates: { 
        summary: !hasData, 
        currentBlock: !data.currentBlock, 
        chart: !hasData 
      }
    })
    console.log(`📊 Partial data loaded (${data.source}):`, { 
      dailyEntries: data.daily?.length || 0, 
      hasCurrentBlock: !!data.currentBlock 
    })
  },

  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),

  setComponentLoading: (component, loading) => set((state) => ({
    loadingStates: { ...state.loadingStates, [component]: loading }
  })),

  loadDataInBackground: () => {
    const { setComponentLoading, setUsageData, setError, loadCachedData } = get()
    
    // Start with fast cached data load (non-blocking)
    loadCachedData()
    
    // Set all components as loading for fresh data
    setComponentLoading('summary', true)
    setComponentLoading('currentBlock', true)
    setComponentLoading('chart', true)

    // Load fresh data asynchronously with shorter timeout for better UX
    const loadAsync = async () => {
      try {
        if (!window.electronAPI?.hardRefreshUsageData) {
          console.warn('Running in development mode - Electron API not available')
          // Clear loading states since no data will come
          setComponentLoading('summary', false)
          setComponentLoading('currentBlock', false)
          setComponentLoading('chart', false)
          return
        }

        console.log('🔄 Loading fresh usage data in background...')
        const data = await Promise.race([
          window.electronAPI.hardRefreshUsageData(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 15s')), 15000))
        ])

        setUsageData(data)
        console.log('✅ Fresh usage data loaded successfully')
      } catch (error) {
        console.error('❌ Failed to load fresh data:', error)
        setError(error instanceof Error ? error.message : 'Failed to load usage data')
        // Clear loading states on error
        setComponentLoading('summary', false)
        setComponentLoading('currentBlock', false)
        setComponentLoading('chart', false)
      }
    }

    // Run in background without awaiting - this allows UI to render immediately
    setTimeout(loadAsync, 100) // Small delay to ensure UI renders first
  },

  // Fast cached data load - loads immediately available data
  loadCachedData: async () => {
    const { setComponentLoading, setUsageData, setError } = get()
    try {
      if (!window.electronAPI?.getUsageData) {
        console.warn('Running in development mode - Electron API not available')
        return
      }

      // Fast cached data load with short timeout
      const data = await Promise.race([
        window.electronAPI.getUsageData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Cache timeout')), 1000))
      ])

      setUsageData(data)
      console.log('✅ Cached data loaded successfully')
    } catch (error) {
      console.warn('Cache load failed, will use hard refresh:', error)
      // Don't set error state for cache failures, just continue with fresh load
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
        setTimeout(() => reject(new Error('Request timeout')), 30000) // 30 second timeout
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
  },

  loadDataForDays: async (days: number) => {
    const { setComponentLoading, setUsageData, setError } = get()
    
    setComponentLoading('chart', true)
    
    try {
      if (!window.electronAPI?.getUsageDataRange) {
        console.warn('Running in development mode - Electron API not available')
        setComponentLoading('chart', false)
        return
      }

      console.log(`🔄 Loading ${days} days of usage data...`)
      
      const data = await Promise.race([
        window.electronAPI.getUsageDataRange(days),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 15000))
      ])

      setUsageData(data)
      console.log(`✅ Successfully loaded ${days} days of usage data`)
    } catch (error) {
      console.error(`❌ Failed to load ${days} days of data:`, error)
      setError(error instanceof Error ? error.message : 'Failed to load usage data')
      setComponentLoading('chart', false)
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
