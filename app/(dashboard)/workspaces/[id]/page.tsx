import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminGetWorkspaceDetail, adminGetUsageSummary, adminListWorkspaceMembersActivity } from '@/lib/admin/rpc'
import { notFound } from 'next/navigation'
import { TierPresetButtons } from '@/components/admin/tier-preset-buttons'
import { AppToggle } from '@/components/admin/app-toggle'
import { UsageChart } from '@/components/admin/usage-chart'

interface PageProps {
  params: Promise<{ id: string }>
}

function formatNumber(num: number): string {
  return num.toLocaleString()
}

function calculateUsagePercent(usage: number, limit: number): number {
  if (limit === 0) return 0
  return Math.min(Math.round((usage / limit) * 100), 100)
}

function getUsageColor(percent: number): string {
  if (percent >= 90) return 'bg-red-500'
  if (percent >= 75) return 'bg-amber-500'
  return 'bg-green-500'
}

function formatLastActive(timestamp: string | null): string {
  if (!timestamp) return 'Never'
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

export default async function WorkspaceDetailPage({ params }: PageProps) {
  const { id } = await params

  let detail
  let usage
  let membersActivity

  try {
    detail = await adminGetWorkspaceDetail(id)
    usage = await adminGetUsageSummary(id)
    membersActivity = await adminListWorkspaceMembersActivity(id)
  } catch (error) {
    console.error('Error fetching workspace:', error)
    notFound()
  }

  const { workspace, members, entitlements } = detail

  // Generate mock 30-day usage data (TODO: replace with real historical data)
  const usageChartData = Array.from({ length: 30 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (29 - i))
    return {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      tokens: Math.floor(Math.random() * 50000) + 10000,
      pulls: Math.floor(Math.random() * 20) + 5,
      runs: Math.floor(Math.random() * 10) + 2,
    }
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link
            href="/workspaces"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to Workspaces
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {workspace.name || 'Unnamed Workspace'}
        </h1>
        <code className="text-sm text-muted-foreground font-mono">
          {workspace.id}
        </code>
      </div>

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>Workspace Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium mb-2">Owner</h3>
              <p className="text-sm">{workspace.owner_email}</p>
              <code className="text-xs text-muted-foreground font-mono">
                {workspace.owner_user_id}
              </code>
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2">Created</h3>
              <p className="text-sm">
                {new Date(workspace.created_at).toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Usage (MTD)</CardTitle>
          <CardDescription>
            Month-to-date usage vs limits across all apps
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Advisor Tokens */}
          {usage.usage.advisor_tokens && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Advisor Tokens</h3>
                <span className="text-sm font-mono">
                  {formatNumber(usage.usage.advisor_tokens.usage)} /{' '}
                  {formatNumber(usage.usage.advisor_tokens.limit_readvise)}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${getUsageColor(
                    calculateUsagePercent(
                      usage.usage.advisor_tokens.usage,
                      usage.usage.advisor_tokens.limit_readvise
                    )
                  )}`}
                  style={{
                    width: `${calculateUsagePercent(
                      usage.usage.advisor_tokens.usage,
                      usage.usage.advisor_tokens.limit_readvise
                    )}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {calculateUsagePercent(
                  usage.usage.advisor_tokens.usage,
                  usage.usage.advisor_tokens.limit_readvise
                )}
                % of limit
              </p>
            </div>
          )}

          {/* Property Fresh Pulls */}
          {usage.usage.property_fresh_pull && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Fresh Property Pulls</h3>
                <span className="text-sm font-mono">
                  {formatNumber(usage.usage.property_fresh_pull.usage)} /{' '}
                  {formatNumber(usage.usage.property_fresh_pull.limit_readvise)}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${getUsageColor(
                    calculateUsagePercent(
                      usage.usage.property_fresh_pull.usage,
                      usage.usage.property_fresh_pull.limit_readvise
                    )
                  )}`}
                  style={{
                    width: `${calculateUsagePercent(
                      usage.usage.property_fresh_pull.usage,
                      usage.usage.property_fresh_pull.limit_readvise
                    )}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {calculateUsagePercent(
                  usage.usage.property_fresh_pull.usage,
                  usage.usage.property_fresh_pull.limit_readvise
                )}
                % of limit
              </p>
            </div>
          )}

          {/* Sense Runs */}
          {usage.usage.sense_run && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Sense Runs</h3>
                <span className="text-sm font-mono">
                  {formatNumber(usage.usage.sense_run.usage)} /{' '}
                  {formatNumber(usage.usage.sense_run.limit_readvise)}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${getUsageColor(
                    calculateUsagePercent(
                      usage.usage.sense_run.usage,
                      usage.usage.sense_run.limit_readvise
                    )
                  )}`}
                  style={{
                    width: `${calculateUsagePercent(
                      usage.usage.sense_run.usage,
                      usage.usage.sense_run.limit_readvise
                    )}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {calculateUsagePercent(
                  usage.usage.sense_run.usage,
                  usage.usage.sense_run.limit_readvise
                )}
                % of limit
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 30-Day Usage Trend */}
      <Card>
        <CardHeader>
          <CardTitle>30-Day Usage Trend</CardTitle>
          <CardDescription>Historical usage patterns</CardDescription>
        </CardHeader>
        <CardContent>
          <UsageChart data={usageChartData} />
        </CardContent>
      </Card>

      {/* Entitlements Panel */}
      <Card>
        <CardHeader>
          <CardTitle>App Entitlements</CardTitle>
          <CardDescription>Manage tier presets and app access</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Tier Preset Buttons */}
          <div>
            <h3 className="text-sm font-medium mb-3">Apply Tier Preset</h3>
            <TierPresetButtons
              workspaceId={workspace.id}
              currentTier={
                entitlements.readvise?.tier ||
                entitlements.rebuild?.tier ||
                entitlements.redeal?.tier
              }
            />
            <p className="text-xs text-muted-foreground mt-2">
              Applies preset to all apps (RE:advise, RE:build, RE:deal)
            </p>
          </div>

          {/* App-specific controls */}
          <div className="space-y-4 pt-4 border-t">
            {Object.entries(entitlements).map(([app, config]) => (
              <div key={app} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold capitalize">RE:{app}</h3>
                  <div className="flex items-center gap-3">
                    <AppToggle
                      workspaceId={workspace.id}
                      app={app}
                      enabled={config.enabled}
                    />
                    <Badge variant={config.enabled ? 'default' : 'outline'}>
                      {config.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    <Badge variant="secondary">{config.tier}</Badge>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    Seats: {Number(config.features?.seats) || 0} | Markets:{' '}
                    {Number(config.features?.markets) || 0}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Members Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Members ({membersActivity?.length || 0})</CardTitle>
          <CardDescription>User activity across all apps</CardDescription>
        </CardHeader>
        <CardContent>
          {!membersActivity || membersActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No members yet
            </p>
          ) : (
            <div className="space-y-3">
              {membersActivity.map((member) => (
                <div
                  key={member.user_id}
                  className="p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium">{member.display_name || member.primary_email}</p>
                        {member.active_now && (
                          <Badge variant="default" className="h-5 bg-green-600 hover:bg-green-700">
                            Active now
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{member.primary_email}</p>
                      <code className="text-xs text-muted-foreground font-mono">
                        {member.user_id}
                      </code>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline">{member.workspace_role}</Badge>
                      {member.platform_role === 'super_admin' && (
                        <Badge variant="default" className="bg-purple-600">Super Admin</Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Last active:</span>
                      <span className="ml-1 font-medium">
                        {formatLastActive(member.last_seen_at_overall)}
                      </span>
                    </div>
                    {member.last_login_at && (
                      <div>
                        <span className="text-muted-foreground">Last login:</span>
                        <span className="ml-1 font-medium">
                          {formatLastActive(member.last_login_at)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Per-app activity */}
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Per-app activity:</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className="flex flex-col">
                        <span className="text-muted-foreground">RE:advise</span>
                        <span className={member.last_seen_at_readvise ? 'font-medium' : 'text-muted-foreground'}>
                          {formatLastActive(member.last_seen_at_readvise)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-muted-foreground">RE:build</span>
                        <span className={member.last_seen_at_rebuild ? 'font-medium' : 'text-muted-foreground'}>
                          {formatLastActive(member.last_seen_at_rebuild)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-muted-foreground">RE:deal</span>
                        <span className={member.last_seen_at_redeal ? 'font-medium' : 'text-muted-foreground'}>
                          {formatLastActive(member.last_seen_at_redeal)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-muted-foreground">REcontrol</span>
                        <span className={member.last_seen_at_recontrol ? 'font-medium' : 'text-muted-foreground'}>
                          {formatLastActive(member.last_seen_at_recontrol)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
