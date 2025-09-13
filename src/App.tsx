import React, { useEffect, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { ReportsAndLogs } from './components/ReportsAndLogs'
import { Settings } from './components/Settings'
import { AutoRenewal } from './components/AutoRenewal'
import { FloatingUsage } from './components/FloatingUsage'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { useUsageStore } from './stores/usageStore'
import { useRenewalStore } from './stores/renewalStore'
import './globals.css'

declare global {
  interface Window {
    electronAPI: import('../electron/preload').ElectronAPI
  }
}

function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'reports' | 'settings' | 'auto-renewal'>('dashboard')
  const { setUsageData } = useUsageStore()
  const { setRenewalStatus } = useRenewalStore()

  // Check if we're in floating mode
  const isFloatingMode = window.location.hash === '#/floating'

  useEffect(() => {
    // Set up event listeners only - data will be loaded when needed by each component
    const handleUsageUpdate = (data: any) => {
      setUsageData(data)
    }

    const handleRenewalStatusUpdate = (status: any) => {
      setRenewalStatus(status)
    }

    window.electronAPI.onUsageUpdate(handleUsageUpdate)
    window.electronAPI.onRenewalStatusUpdate(handleRenewalStatusUpdate)

    // Cleanup listeners on unmount
    return () => {
      window.electronAPI.removeAllListeners('usage-update')
      window.electronAPI.removeAllListeners('renewal-status-update')
    }
  }, [setUsageData, setRenewalStatus])

  // Render floating view if in floating mode
  if (isFloatingMode) {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <FloatingUsage />
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      
      <div className="flex-1 flex flex-col">
        <Header />
        
        <main className="flex-1 p-6 overflow-auto">
          {activeView === 'dashboard' && <Dashboard />}
          {activeView === 'auto-renewal' && <AutoRenewal />}
          {activeView === 'reports' && <ReportsAndLogs />}
          {activeView === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  )
}

export default App
