import React, { useState, useMemo, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { useUsageStore } from '@/stores/usageStore'
import { formatCurrency, formatTokens } from '@/lib/utils'
import { 
  Filter, 
  Download, 
  Calendar,
  TrendingUp,
  BarChart3,
  PieChart
} from 'lucide-react'
import { Skeleton } from './ui/skeleton'

type TimeRange = '7d' | '30d' | '90d' | 'all'
type GroupBy = 'day' | 'week' | 'month'

export function Reports() {
  const { usageData, isLoading, refreshData, loadDataForDays } = useUsageStore()
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  const [groupBy, setGroupBy] = useState<GroupBy>('day')
  const [modelFilter, setModelFilter] = useState<string>('all')
  const [isFilterLoading, setIsFilterLoading] = useState(false)

  // Load data when time range changes
  useEffect(() => {
    const loadRequiredData = async () => {
      let days: number
      
      if (timeRange === 'all') {
        days = 365 // Load a full year for "All Time"
      } else {
        days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
      }
      
      await loadDataForDays(days)
    }
    
    loadRequiredData()
  }, [timeRange, loadDataForDays])

  const filteredData = useMemo(() => {
    let data = [...usageData.daily]
    
    // Apply time range filter
    if (timeRange !== 'all') {
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      const cutoffString = cutoff.toISOString().split('T')[0]
      data = data.filter(item => item.date >= cutoffString)
    }
    
    // Apply model filter (placeholder - would need model data)
    if (modelFilter !== 'all') {
      // This would filter by model when we have that data
    }
    
    return data
  }, [usageData.daily, timeRange, modelFilter])

  const aggregatedStats = useMemo(() => {
    const totalCost = filteredData.reduce((sum, item) => sum + item.cost, 0)
    const totalTokens = filteredData.reduce((sum, item) => sum + item.totalTokens, 0)
    const avgDailyCost = filteredData.length > 0 ? totalCost / filteredData.length : 0
    const avgDailyTokens = filteredData.length > 0 ? totalTokens / filteredData.length : 0
    
    return {
      totalCost,
      totalTokens,
      avgDailyCost,
      avgDailyTokens,
      totalDays: filteredData.length
    }
  }, [filteredData])

  const exportToCSV = () => {
    const headers = ['Date', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Cost (USD)']
    const csvContent = [
      headers.join(','),
      ...filteredData.map(item => [
        item.date,
        item.inputTokens,
        item.outputTokens,
        item.totalTokens,
        item.cost.toFixed(4)
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `claude-usage-${timeRange}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </div>
              <Skeleton className="h-7 w-24 mb-2" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="p-4 border rounded-lg">
          <div className="mb-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64 mt-2" />
          </div>
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-end">
        <Button onClick={exportToCSV} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Filter className="h-5 w-5" />
            <span>Filters</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {/* Time Range */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Time Range</label>
              <div className="flex space-x-2">
                {[
                  { value: '7d', label: '7 Days' },
                  { value: '30d', label: '30 Days' },
                  { value: '90d', label: '90 Days' },
                  { value: 'all', label: 'All Time' }
                ].map(option => (
                  <Button
                    key={option.value}
                    variant={timeRange === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTimeRange(option.value as TimeRange)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Group By */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Group By</label>
              <div className="flex space-x-2">
                {[
                  { value: 'day', label: 'Day' },
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' }
                ].map(option => (
                  <Button
                    key={option.value}
                    variant={groupBy === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setGroupBy(option.value as GroupBy)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(aggregatedStats.totalCost)}
            </div>
            <p className="text-xs text-muted-foreground">
              Avg: {formatCurrency(aggregatedStats.avgDailyCost)}/day
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatTokens(aggregatedStats.totalTokens)}
            </div>
            <p className="text-xs text-muted-foreground">
              Avg: {formatTokens(Math.round(aggregatedStats.avgDailyTokens))}/day
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Days Active</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{aggregatedStats.totalDays}</div>
            <p className="text-xs text-muted-foreground">
              In selected range
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Efficiency</CardTitle>
            <PieChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {aggregatedStats.totalTokens > 0 ? 
                formatCurrency(aggregatedStats.totalCost / aggregatedStats.totalTokens * 1000) : 
                '$0'
              }
            </div>
            <p className="text-xs text-muted-foreground">
              Per 1K tokens
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Daily Usage Data</CardTitle>
          <CardDescription>
            Detailed breakdown of usage by day
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Date</th>
                  <th className="text-right p-2">Input Tokens</th>
                  <th className="text-right p-2">Output Tokens</th>
                  <th className="text-right p-2">Total Tokens</th>
                  <th className="text-right p-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.slice(0, 50).map((item) => ( // Limit to 50 rows for performance
                  <tr key={item.date} className="border-b hover:bg-muted/50">
                    <td className="p-2 font-medium">{item.date}</td>
                    <td className="p-2 text-right">{formatTokens(item.inputTokens)}</td>
                    <td className="p-2 text-right">{formatTokens(item.outputTokens)}</td>
                    <td className="p-2 text-right font-medium">{formatTokens(item.totalTokens)}</td>
                    <td className="p-2 text-right font-medium">{formatCurrency(item.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredData.length > 50 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Showing first 50 of {filteredData.length} entries. Export CSV for full data.
              </div>
            )}
            {filteredData.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">
                No data available for the selected time range.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
