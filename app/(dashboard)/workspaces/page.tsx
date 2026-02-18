import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { adminListWorkspacesActivity } from '@/lib/admin/rpc'

interface PageProps {
  searchParams: Promise<{ search?: string }>
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

export default async function WorkspacesPage({ searchParams }: PageProps) {
  const params = await searchParams
  const search = params.search

  const workspaces = await adminListWorkspacesActivity(search, 100, 0)

  return (
    <div className="space-y-6 blueprint-bg">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
        <p className="text-muted-foreground">
          Manage workspaces, entitlements, and usage
        </p>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Search Workspaces</CardTitle>
          <CardDescription>
            Search by workspace name, owner email, or ID
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/dashboard/workspaces" method="get">
            <Input
              name="search"
              placeholder="Search workspaces..."
              defaultValue={search}
              className="max-w-md"
            />
          </form>
        </CardContent>
      </Card>

      {/* Workspaces Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {workspaces.length} Workspace{workspaces.length !== 1 ? 's' : ''}
          </CardTitle>
          <CardDescription>
            {search ? `Filtered by "${search}"` : 'All workspaces in the system'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? 'No workspaces found matching your search' : 'No workspaces yet'}
            </p>
          ) : (
            <div className="space-y-2">
              {workspaces.map((workspace) => (
                <Link
                  key={workspace.workspace_id}
                  href={`/workspaces/${workspace.workspace_id}`}
                  className="block"
                >
                  <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">
                          {workspace.workspace_name || 'Unnamed Workspace'}
                        </h3>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                          {workspace.workspace_id.slice(0, 8)}
                        </code>
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          Created {new Date(workspace.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">
                          Last active: {formatLastActive(workspace.last_active_at_overall)}
                        </span>
                        {workspace.active_users_now_overall > 0 && (
                          <>
                            <span className="text-xs text-muted-foreground">•</span>
                            <Badge variant="default" className="text-xs h-5 bg-green-600 hover:bg-green-700">
                              {workspace.active_users_now_overall} active now
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-muted-foreground ml-4">→</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
