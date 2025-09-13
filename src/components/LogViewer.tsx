import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { 
  ScrollText,
  RefreshCw,
  Download,
  Filter,
  X,
  AlertCircle,
  Info,
  CheckCircle,
  Clock,
  Trash2
} from 'lucide-react'

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  category: 'schedule' | 'service' | 'renewal' | 'session'
}

export function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState<{
    level: string | null
    category: string | null
    search: string
  }>({
    level: null,
    category: null,
    search: ''
  })
  const [logsPath, setLogsPath] = useState<string>('')
  const [isClearingLogs, setIsClearingLogs] = useState(false)

  const loadLogs = async () => {
    setIsLoading(true)
    try {
      const logData = await window.electronAPI.getRenewalLogs?.(7) || [] // Last 7 days
      setLogs(logData)
      
      // Also get logs path for display
      const path = await window.electronAPI.getLogsPath?.()
      if (path) {
        setLogsPath(path)
      }
    } catch (error) {
      console.error('Failed to load renewal logs:', error)
      setLogs([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()
  }, [])

  useEffect(() => {
    let filtered = logs
    
    if (filter.level) {
      filtered = filtered.filter(log => log.level === filter.level)
    }
    
    if (filter.category) {
      filtered = filtered.filter(log => log.category === filter.category)
    }
    
    if (filter.search) {
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(filter.search.toLowerCase())
      )
    }
    
    setFilteredLogs(filtered)
  }, [logs, filter])

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      case 'warn':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />
      case 'info':
        return <Info className="h-4 w-4 text-blue-500" />
      default:
        return <CheckCircle className="h-4 w-4 text-green-500" />
    }
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-600 dark:text-red-400'
      case 'warn':
        return 'text-yellow-600 dark:text-yellow-400'
      case 'info':
        return 'text-blue-600 dark:text-blue-400'
      default:
        return 'text-green-600 dark:text-green-400'
    }
  }

  const exportLogs = async () => {
    try {
      const content = filteredLogs.map(log => 
        `${new Date(log.timestamp).toLocaleString()} [${log.level.toUpperCase()}] [${log.category.toUpperCase()}] ${log.message}`
      ).join('\n')
      
      const result = await window.electronAPI.exportRenewalLogs?.(content)
      if (result?.success) {
        console.log('Logs exported to:', result.path)
      }
    } catch (error) {
      console.error('Failed to export logs:', error)
    }
  }

  const clearFilter = () => {
    setFilter({
      level: null,
      category: null,
      search: ''
    })
  }

  const clearOldLogs = async () => {
    setIsClearingLogs(true)
    try {
      // Calculate date 1 day ago
      const oneDayAgo = new Date()
      oneDayAgo.setDate(oneDayAgo.getDate() - 1)
      
      const result = await window.electronAPI.clearRenewalLogs?.(oneDayAgo.toISOString())
      if (result?.success) {
        // Reload logs to show updated list
        await loadLogs()
        console.log('Logs older than 1 day cleared successfully')
      } else {
        console.error('Failed to clear old logs:', result?.error)
      }
    } catch (error) {
      console.error('Failed to clear old logs:', error)
    } finally {
      setIsClearingLogs(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        {logsPath && (
          <p className="text-sm text-muted-foreground">
            Logs stored in: {logsPath}
          </p>
        )}
        <div className="flex space-x-2">
          <Button onClick={loadLogs} disabled={isLoading} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={exportLogs} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button 
            onClick={clearOldLogs} 
            disabled={isClearingLogs} 
            variant="outline" 
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/20"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {isClearingLogs ? 'Clearing...' : 'Clear Old'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Filter className="h-5 w-5" />
            <span>Filters</span>
            {(filter.level || filter.category || filter.search) && (
              <Button onClick={clearFilter} variant="ghost" size="sm">
                <X className="h-4 w-4" />
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Level</label>
              <select
                value={filter.level || ''}
                onChange={(e) => setFilter(prev => ({ ...prev, level: e.target.value || null }))}
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Levels</option>
                <option value="error">Error</option>
                <option value="warn">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
            </div>
            
            <div>
              <label className="text-sm font-medium">Category</label>
              <select
                value={filter.category || ''}
                onChange={(e) => setFilter(prev => ({ ...prev, category: e.target.value || null }))}
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm bg-secondary text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Categories</option>
                <option value="schedule">Schedule</option>
                <option value="service">Service</option>
                <option value="renewal">Renewal</option>
                <option value="session">Session</option>
              </select>
            </div>
            
            <div>
              <label className="text-sm font-medium">Search</label>
              <input
                type="text"
                placeholder="Search log messages..."
                value={filter.search}
                onChange={(e) => setFilter(prev => ({ ...prev, search: e.target.value }))}
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm bg-secondary text-foreground placeholder:text-muted-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log Entries */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Log Entries ({filteredLogs.length})</CardTitle>
          <CardDescription>
            Auto-renewal scheduling, service events, and session activity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-8">
                <div className="flex flex-col items-center space-y-2">
                  <ScrollText className="h-12 w-12 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">No log entries found</p>
                  <p className="text-xs text-muted-foreground">
                    {logs.length === 0 ? 'No logs available' : 'Try adjusting your filters'}
                  </p>
                </div>
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <div
                  key={index}
                  className="p-3 border rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-start space-x-3">
                    {getLevelIcon(log.level)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className={`text-xs font-medium uppercase tracking-wide ${getLevelColor(log.level)}`}>
                          {log.level}
                        </span>
                        {log.category && (
                          <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">
                            {log.category}
                          </span>
                        )}
                        <div className="flex items-center space-x-1 text-xs text-muted-foreground ml-auto">
                          <Clock className="h-3 w-3" />
                          <span>{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                      <p className="text-sm text-foreground">{log.message}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}