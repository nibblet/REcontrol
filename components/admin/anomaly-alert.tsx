import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Anomaly } from '@/lib/admin/anomaly'

interface AnomalyAlertProps {
  anomalies: Anomaly[]
}

function getSeverityColor(severity: 'warning' | 'critical'): string {
  return severity === 'critical'
    ? 'border-red-500 bg-red-50 dark:bg-red-950'
    : 'border-amber-500 bg-amber-50 dark:bg-amber-950'
}

function getSeverityBadge(severity: 'warning' | 'critical') {
  return severity === 'critical' ? (
    <Badge variant="destructive">Critical</Badge>
  ) : (
    <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
      Warning
    </Badge>
  )
}

export function AnomalyAlert({ anomalies }: AnomalyAlertProps) {
  if (anomalies.length === 0) {
    return (
      <Card className="border-green-500/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="text-2xl">✓</span>
            <div>
              <CardTitle>All Systems Normal</CardTitle>
              <CardDescription>No anomalies detected</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    )
  }

  const criticalCount = anomalies.filter((a) => a.severity === 'critical').length
  const warningCount = anomalies.filter((a) => a.severity === 'warning').length

  return (
    <Card className={getSeverityColor(criticalCount > 0 ? 'critical' : 'warning')}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            <div>
              <CardTitle>
                {anomalies.length} {anomalies.length === 1 ? 'Anomaly' : 'Anomalies'} Detected
              </CardTitle>
              <CardDescription>
                {criticalCount > 0 && `${criticalCount} critical`}
                {criticalCount > 0 && warningCount > 0 && ', '}
                {warningCount > 0 && `${warningCount} warning`}
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {anomalies.slice(0, 5).map((anomaly, index) => (
            <div
              key={index}
              className="flex items-start justify-between p-3 rounded-lg border bg-background"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {getSeverityBadge(anomaly.severity)}
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {anomaly.type.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm font-medium">{anomaly.message}</p>
                {anomaly.workspaceName && (
                  <Link
                    href={`/workspaces/${anomaly.workspaceId}`}
                    className="text-xs text-primary hover:underline mt-1 inline-block"
                  >
                    View workspace →
                  </Link>
                )}
              </div>
            </div>
          ))}

          {anomalies.length > 5 && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              +{anomalies.length - 5} more {anomalies.length - 5 === 1 ? 'anomaly' : 'anomalies'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
