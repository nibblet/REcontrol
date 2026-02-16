import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminGetSenseOpsSummary } from '@/lib/admin/rpc'

function getStatusColor(successRate: number): string {
  if (successRate >= 95) return 'bg-green-500'
  if (successRate >= 75) return 'bg-amber-500'
  return 'bg-red-500'
}

function getStatusEmoji(successRate: number): string {
  if (successRate >= 95) return '🟢'
  if (successRate >= 75) return '🟡'
  return '🔴'
}

function getStatusLabel(successRate: number): string {
  if (successRate >= 95) return 'Active'
  if (successRate >= 75) return 'Partial'
  return 'Down'
}

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return 'Never'

  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}

export default async function SenseOpsPage() {
  const markets = await adminGetSenseOpsSummary()

  return (
    <div className="space-y-6 blueprint-bg">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Sense Operations</h1>
        <p className="text-muted-foreground">
          Multi-market monitoring and job execution status
        </p>
      </div>

      {/* Markets Overview Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {markets.map((market) => (
          <Card key={market.market_id} className="relative overflow-hidden">
            {/* Status Indicator */}
            <div
              className={`absolute top-0 right-0 w-2 h-full ${getStatusColor(
                market.success_rate_24h
              )}`}
            />

            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {getStatusEmoji(market.success_rate_24h)} {market.market_name}
                </CardTitle>
                <Badge variant={market.enabled ? 'default' : 'outline'}>
                  {market.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <CardDescription className="font-mono text-xs">
                {market.market_code}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="outline">
                  {getStatusLabel(market.success_rate_24h)}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Run</span>
                <span className="text-sm font-mono">
                  {formatRelativeTime(market.last_run_at)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">24h Success</span>
                <span className="text-sm font-bold font-mono metric-glow">
                  {market.success_rate_24h.toFixed(1)}%
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Job Runs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Job Runs</CardTitle>
          <CardDescription>Latest execution results across all markets</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {markets.map((market) => (
              <div key={market.market_id} className="space-y-2">
                <h3 className="font-semibold text-sm border-b pb-2">
                  {market.market_name}
                </h3>

                {!market.recent_runs || market.recent_runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No runs yet for this market
                  </p>
                ) : (
                  <div className="space-y-2">
                    {market.recent_runs.slice(0, 5).map((run) => (
                      <div
                        key={run.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                            {run.status === 'success' && '✓'}
                            {run.status === 'partial' && '⚠'}
                            {run.status === 'failed' && '✗'}
                            {run.status === 'running' && '⟳'}
                          </div>

                          <div>
                            <code className="text-xs font-mono text-muted-foreground">
                              {run.id.slice(0, 8)}
                            </code>
                            <p className="text-sm">
                              {run.successful_tasks}/{run.total_tasks} tasks
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <Badge
                            variant={
                              run.status === 'success'
                                ? 'default'
                                : run.status === 'partial'
                                ? 'outline'
                                : 'destructive'
                            }
                          >
                            {run.status}
                          </Badge>

                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(run.started_at)}
                          </span>
                        </div>

                        {run.error_summary && (
                          <details className="col-span-full mt-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                              View errors
                            </summary>
                            <pre className="mt-2 text-xs p-2 bg-muted rounded overflow-auto">
                              {run.error_summary}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle>About Sense Operations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            RE:sense runs automated market analysis jobs to gather property data across
            multiple markets. Each market is monitored independently.
          </p>
          <p>
            <strong>Status Indicators:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>🟢 Active (≥95% success in last 24h)</li>
            <li>🟡 Partial (75-95% success in last 24h)</li>
            <li>🔴 Down (&lt;75% success in last 24h)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
