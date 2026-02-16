import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/admin/stat-card'
import { AnomalyAlert } from '@/components/admin/anomaly-alert'
import { adminGetMTDTotals, adminListTopUsage, adminGetSenseOpsSummary } from '@/lib/admin/rpc'
import { detectSenseAnomalies } from '@/lib/admin/anomaly'

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
}

export default async function DashboardPage() {
  // Fetch MTD totals
  const mtdTotals = await adminGetMTDTotals()

  // Fetch top workspaces by token usage
  const topWorkspaces = await adminListTopUsage('advisor_tokens', undefined, 5)

  // Fetch sense ops for anomaly detection
  const senseMarkets = await adminGetSenseOpsSummary()

  // Detect anomalies
  const senseAnomalies = detectSenseAnomalies(senseMarkets)

  return (
    <div className="space-y-6 blueprint-bg">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Operator Dashboard</h1>
        <p className="text-muted-foreground">
          Month-to-date metrics across the RE:ecosystem
        </p>
      </div>

      {/* Anomalies Alert */}
      <AnomalyAlert anomalies={senseAnomalies} />

      {/* MTD Stats Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Advisor Tokens"
          value={formatNumber(mtdTotals.advisor_tokens)}
          subtitle="Total tokens consumed (MTD)"
          className="border-chart-1/30"
        />
        <StatCard
          title="Fresh Property Pulls"
          value={formatNumber(mtdTotals.property_fresh_pull)}
          subtitle="Live data fetches (MTD)"
          className="border-chart-2/30"
        />
        <StatCard
          title="Sense Runs"
          value={formatNumber(mtdTotals.sense_run)}
          subtitle="Market analysis jobs (MTD)"
          className="border-chart-3/30"
        />
      </div>

      {/* Top Workspaces */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Top Workspaces by Token Usage</CardTitle>
              <CardDescription>Highest consumers this month</CardDescription>
            </div>
            <Link href="/workspaces">
              <Button variant="outline" size="sm">
                View All
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {topWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No usage data yet for this month
            </p>
          ) : (
            <div className="space-y-3">
              {topWorkspaces.map((workspace, index) => (
                <Link
                  key={workspace.workspace_id}
                  href={`/workspaces/${workspace.workspace_id}`}
                  className="block"
                >
                  <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-mono text-sm font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium">
                          {workspace.workspace_name || 'Unnamed Workspace'}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {workspace.workspace_id.slice(0, 8)}...
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold font-mono metric-glow">
                        {formatNumber(workspace.total_quantity)}
                      </p>
                      <p className="text-xs text-muted-foreground">tokens</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common operator tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            <Link href="/workspaces">
              <Button variant="outline" className="w-full justify-start">
                📊 Manage Workspaces
              </Button>
            </Link>
            <Link href="/sense">
              <Button variant="outline" className="w-full justify-start">
                🔍 Sense Operations
              </Button>
            </Link>
            <Link href="/audit">
              <Button variant="outline" className="w-full justify-start">
                📝 Audit Log
              </Button>
            </Link>
            <Button variant="outline" className="w-full justify-start" disabled>
              ⚠️ Anomalies (Coming Soon)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
