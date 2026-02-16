import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { adminListWorkspaces } from '@/lib/admin/rpc'

interface PageProps {
  searchParams: Promise<{ search?: string }>
}

function getTierBadgeVariant(tier: string): 'default' | 'secondary' | 'outline' {
  if (tier === 'pro') return 'default'
  if (tier === 'team') return 'secondary'
  return 'outline'
}

function getTierColor(tier: string): string {
  if (tier === 'pro') return 'text-purple-500'
  if (tier === 'team') return 'text-blue-500'
  return 'text-gray-500'
}

export default async function WorkspacesPage({ searchParams }: PageProps) {
  const params = await searchParams
  const search = params.search

  const workspaces = await adminListWorkspaces(search, 100, 0)

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
                      <p className="text-sm text-muted-foreground truncate">
                        {workspace.owner_email}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-muted-foreground">
                          {workspace.member_count} member{workspace.member_count !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">
                          Created {new Date(workspace.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 ml-4">
                      {/* App Tiers */}
                      <div className="hidden md:flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-16">RE:advise</span>
                          <Badge variant={getTierBadgeVariant(workspace.tier_readvise)} className="w-16 justify-center">
                            {workspace.tier_readvise}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-16">RE:build</span>
                          <Badge variant={getTierBadgeVariant(workspace.tier_rebuild)} className="w-16 justify-center">
                            {workspace.tier_rebuild}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-16">RE:deal</span>
                          <Badge variant={getTierBadgeVariant(workspace.tier_redeal)} className="w-16 justify-center">
                            {workspace.tier_redeal}
                          </Badge>
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="text-muted-foreground">→</div>
                    </div>
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
