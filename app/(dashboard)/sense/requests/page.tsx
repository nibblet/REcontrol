import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminListMarketRequests } from '@/lib/admin/sense-queries'
import RequestActions from './RequestActions'

const STATUS_ORDER = ['new', 'triaged', 'planned', 'shipped', 'closed']

function statusBadgeVariant(status: string): 'default' | 'outline' | 'destructive' | 'secondary' {
  if (status === 'shipped') return 'default'
  if (status === 'planned') return 'outline'
  if (status === 'closed') return 'secondary'
  if (status === 'new') return 'destructive'
  return 'outline'
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString()
}

export default async function MarketRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const requests = await adminListMarketRequests(status)

  // Count by status for the filter tabs
  const allRequests = status ? await adminListMarketRequests() : requests
  const countByStatus = allRequests.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Market Requests</h1>
        <p className="text-muted-foreground">
          Workspace requests for Sense market access
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        <a
          href="/sense/requests"
          className={`text-sm px-3 py-1 rounded-full border transition-colors ${
            !status ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
        >
          All ({allRequests.length})
        </a>
        {STATUS_ORDER.map((s) => (
          <a
            key={s}
            href={`/sense/requests?status=${s}`}
            className={`text-sm px-3 py-1 rounded-full border transition-colors ${
              status === s ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
            }`}
          >
            {s} ({countByStatus[s] ?? 0})
          </a>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
          <CardDescription>
            {requests.length} request{requests.length !== 1 ? 's' : ''}
            {status ? ` with status "${status}"` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No requests found.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="border rounded-lg p-4 space-y-2 hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{req.raw_input}</span>
                        <Badge variant={statusBadgeVariant(req.status)} className="shrink-0">
                          {req.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground space-x-3">
                        <span>{req.workspace_name ?? req.workspace_id.slice(0, 8)}</span>
                        <span>{formatDate(req.created_at)}</span>
                        {req.resolved_market_key && (
                          <span className="font-mono">→ {req.resolved_market_key}</span>
                        )}
                      </div>
                      {req.note && (
                        <p className="text-xs text-muted-foreground italic">{req.note}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      <RequestActions
                        requestId={req.id}
                        resolvedMarketKey={req.resolved_market_key}
                        currentStatus={req.status}
                      />
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
