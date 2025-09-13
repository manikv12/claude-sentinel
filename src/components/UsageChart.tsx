import React, { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { UsageData } from '@/stores/usageStore'
import { formatTokens, formatCurrency } from '@/lib/utils'

interface UsageChartProps {
  data: UsageData[]
  height?: number
  type?: 'area' | 'bar'
  showCost?: boolean
  viewType?: 'daily' | 'sessions'
}

export function UsageChart({ data, height = 250, type = 'area', showCost = false, viewType = 'daily' }: UsageChartProps) {
  const chartData = useMemo(() => {
    if (!data.length) return []

    try {
      if (viewType === 'sessions') {
        // For sessions, show last 20 sessions or all if less than 20
        const sessionData = data.slice(-20)
        const startIndex = Math.max(0, data.length - 20)

        return sessionData.map((d, index) => ({
          date: `Session ${startIndex + index + 1}`,
          fullDate: d.date,
          tokens: d.totalTokens || 0,
          cost: d.cost || 0,
          inputTokens: d.inputTokens || 0,
          outputTokens: d.outputTokens || 0,
          value: showCost ? (d.cost || 0) : (d.totalTokens || 0),
          sessionIndex: startIndex + index + 1
        }))
      } else {
        // For daily view, show last 7 days
        return data.slice(-7).map(d => ({
          date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          fullDate: d.date,
          tokens: d.totalTokens || 0,
          cost: d.cost || 0,
          inputTokens: d.inputTokens || 0,
          outputTokens: d.outputTokens || 0,
          value: showCost ? (d.cost || 0) : (d.totalTokens || 0)
        }))
      }
    } catch (error) {
      console.error('Error processing chart data:', error)
      return []
    }
  }, [data, showCost, viewType])

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <div className="text-center">
          <p>No {viewType === 'sessions' ? 'session' : 'usage'} data available</p>
          {viewType === 'sessions' && (
            <p className="text-xs mt-1">Session data may not be available yet</p>
          )}
        </div>
      </div>
    )
  }

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <div className="text-center">
          <p>Unable to process chart data</p>
          <p className="text-xs mt-1">Please try refreshing or switch to daily view</p>
        </div>
      </div>
    )
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg p-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">{label}</p>
            {viewType === 'sessions' && data.fullDate && (
              <p className="text-xs text-muted-foreground">
                {new Date(data.fullDate).toLocaleString()}
              </p>
            )}
          </div>
          <div className="space-y-1 mt-2">
            {showCost ? (
              <p className="text-sm text-primary">
                Cost: {formatCurrency(data.cost)}
              </p>
            ) : (
              <>
                <p className="text-sm text-blue-600">
                  Input: {formatTokens(data.inputTokens)}
                </p>
                <p className="text-sm text-green-600">
                  Output: {formatTokens(data.outputTokens)}
                </p>
                <p className="text-sm font-medium text-primary">
                  Total: {formatTokens(data.tokens)}
                </p>
              </>
            )}
          </div>
        </div>
      )
    }
    return null
  }

  const formatYAxis = (value: number) => {
    return showCost ? formatCurrency(value) : formatTokens(value)
  }

  if (type === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis
            tickFormatter={formatYAxis}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="value"
            fill="hsl(var(--primary))"
            radius={[2, 2, 0, 0]}
            opacity={0.8}
          />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={{ stroke: 'hsl(var(--border))' }}
        />
        <YAxis
          tickFormatter={formatYAxis}
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={{ stroke: 'hsl(var(--border))' }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}