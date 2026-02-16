import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  trend?: {
    value: number
    isPositive: boolean
  }
  className?: string
}

export function StatCard({ title, value, subtitle, trend, className }: StatCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          <div className="text-2xl font-bold metric-glow font-mono">
            {value}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
          {trend && (
            <div className="flex items-center gap-1 text-xs">
              <span className={trend.isPositive ? 'text-green-500' : 'text-red-500'}>
                {trend.isPositive ? '▲' : '▼'} {Math.abs(trend.value)}%
              </span>
              <span className="text-muted-foreground">vs last month</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
