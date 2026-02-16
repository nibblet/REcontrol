'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface UsageDataPoint {
  date: string
  tokens: number
  pulls: number
  runs: number
}

interface UsageChartProps {
  data: UsageDataPoint[]
  height?: number
}

export function UsageChart({ data, height = 300 }: UsageChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
        No usage data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-xs"
          tick={{ fill: 'hsl(var(--muted-foreground))' }}
        />
        <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '0.5rem',
          }}
          labelStyle={{ color: 'hsl(var(--foreground))' }}
        />
        <Legend
          wrapperStyle={{ fontSize: '12px' }}
          iconType="line"
        />
        <Line
          type="monotone"
          dataKey="tokens"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          dot={{ fill: 'hsl(var(--chart-1))' }}
          name="Tokens"
        />
        <Line
          type="monotone"
          dataKey="pulls"
          stroke="hsl(var(--chart-2))"
          strokeWidth={2}
          dot={{ fill: 'hsl(var(--chart-2))' }}
          name="Fresh Pulls"
        />
        <Line
          type="monotone"
          dataKey="runs"
          stroke="hsl(var(--chart-3))"
          strokeWidth={2}
          dot={{ fill: 'hsl(var(--chart-3))' }}
          name="Sense Runs"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
