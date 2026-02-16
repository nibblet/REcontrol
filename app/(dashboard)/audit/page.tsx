import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminGetAuditLog } from '@/lib/admin/audit'

interface PageProps {
  searchParams: Promise<{ workspace?: string; action?: string }>
}

function getActionColor(action: string): 'default' | 'secondary' | 'outline' {
  if (action === 'set_workspace_tier') return 'default'
  if (action === 'set_app_enabled') return 'secondary'
  return 'outline'
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  const params = await searchParams
  const workspace = params.workspace
  const action = params.action

  const entries = await adminGetAuditLog(workspace, action, 100, 0)

  return (
    <div className="space-y-6 blueprint-bg">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">
          Complete history of all super admin actions
        </p>
      </div>

      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Filter audit log entries (full filter UI coming soon)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline">All Actions ({entries.length})</Badge>
            {workspace && (
              <Badge variant="secondary">Workspace: {workspace.slice(0, 8)}...</Badge>
            )}
            {action && <Badge variant="secondary">Action: {action}</Badge>}
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Entries */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Actions</CardTitle>
          <CardDescription>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No audit log entries yet
            </p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Header Row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={getActionColor(entry.action)}>
                          {entry.action}
                        </Badge>
                        <span className="text-sm text-muted-foreground">by</span>
                        <span className="text-sm font-medium">
                          {entry.actor_email || 'Unknown'}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {formatTimestamp(entry.created_at)}
                        </span>
                      </div>

                      {/* Workspace */}
                      {entry.workspace_name && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">Workspace:</span>{' '}
                          <span className="font-medium">{entry.workspace_name}</span>
                          <code className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                            {entry.workspace_id?.slice(0, 8)}...
                          </code>
                        </div>
                      )}

                      {/* Reason */}
                      <div className="text-sm">
                        <span className="text-muted-foreground">Reason:</span>{' '}
                        <span className="italic">{entry.reason}</span>
                      </div>

                      {/* Changes Summary */}
                      {entry.before_state && entry.after_state && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            View changes
                          </summary>
                          <div className="mt-2 grid md:grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
                            <div>
                              <h4 className="font-semibold mb-1">Before</h4>
                              <pre className="text-xs overflow-auto">
                                {JSON.stringify(entry.before_state, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <h4 className="font-semibold mb-1">After</h4>
                              <pre className="text-xs overflow-auto">
                                {JSON.stringify(entry.after_state, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </details>
                      )}

                      {/* Metadata */}
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        {entry.ip_address && (
                          <span>IP: {entry.ip_address}</span>
                        )}
                        <span className="font-mono text-xs truncate max-w-xs">
                          {entry.id}
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
