import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminGetSenseMarketDetail } from '@/lib/admin/sense-queries'
import MarketActions from './MarketActions'

type Props = {
  params: Promise<{ marketId: string }>
}

function statusBadgeVariant(status: string | null): 'default' | 'outline' | 'destructive' {
  if (status === 'available') return 'default'
  if (status === 'partial') return 'outline'
  return 'destructive'
}

function runStatusVariant(status: string): 'default' | 'outline' | 'destructive' {
  if (status === 'completed') return 'default'
  if (status === 'processing') return 'outline'
  return 'destructive'
}

function formatDatetime(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function durationMs(started: string | null, finished: string | null): string {
  if (!started || !finished) return '—'
  const ms = new Date(finished).getTime() - new Date(started).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

const STEPS = ['validate', 'tracts', 'crosswalk', 'acs', 'zillow', 'hud_safmr', 'snapshots', 'neighborhoods', 'publish']

function StepChip({ name, entry }: { name: string; entry?: { status: string; error?: string } | null }) {
  if (!entry) return <span className="text-xs text-muted-foreground px-2 py-0.5 rounded border">{name}</span>
  const color =
    entry.status === 'completed' ? 'bg-green-100 text-green-800 border-green-200' :
    entry.status === 'running' ? 'bg-blue-100 text-blue-800 border-blue-200' :
    entry.status === 'failed' ? 'bg-red-100 text-red-800 border-red-200' :
    'bg-muted text-muted-foreground border'
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded border ${color}`}
      title={entry.error ?? undefined}
    >
      {name}
    </span>
  )
}

function FlagRow({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-mono ${value ? 'text-green-600' : 'text-muted-foreground'}`}>
        {value === null ? '—' : value ? 'Yes' : 'No'}
      </span>
    </div>
  )
}

export default async function MarketDetailPage({ params }: Props) {
  const { marketId } = await params
  const detail = await adminGetSenseMarketDetail(marketId)

  if (!detail) notFound()

  const { market, tractCount, countyCount, recentRuns } = detail

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/sense/markets" className="hover:text-foreground">Markets</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{market.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{market.name}</h1>
          <p className="text-muted-foreground font-mono text-sm">{market.market_key}</p>
          {market.cbsa_code && (
            <p className="text-muted-foreground text-sm">CBSA {market.cbsa_code}</p>
          )}
        </div>
        <Badge variant={statusBadgeVariant(market.status)} className="text-sm px-3 py-1">
          {market.status ?? 'No data'}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coverage flags */}
        <Card>
          <CardHeader>
            <CardTitle>Coverage</CardTitle>
            <CardDescription>
              {tractCount.toLocaleString()} tracts · {countyCount} counties
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <FlagRow label="Tracts loaded" value={market.has_tracts} />
            <FlagRow label="Geometry loaded" value={market.has_geometry} />
            <FlagRow label="ACS projections" value={market.has_projections} />
            <FlagRow label="HPI (Zillow)" value={market.has_hpi} />
            <FlagRow label="Neighborhoods" value={market.has_neighborhoods} />
            <FlagRow label="SAFMR" value={market.has_safmr} />
            {market.availability_updated_at && (
              <div className="pt-2 text-xs text-muted-foreground">
                Last updated: {formatDatetime(market.availability_updated_at)}
              </div>
            )}
            {market.notes && (
              <p className="pt-2 text-xs text-muted-foreground italic">{market.notes}</p>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>
              Bootstrap triggers the full pipeline in readvise (async). Validate checks readiness.
              Publish manually sets availability to &ldquo;available&rdquo;.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MarketActions marketId={market.id} marketKey={market.market_key} />
          </CardContent>
        </Card>
      </div>

      {/* Pipeline runs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Bootstrap Runs</CardTitle>
          <CardDescription>Last {recentRuns.length} runs</CardDescription>
        </CardHeader>
        <CardContent>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No runs yet.</p>
          ) : (
            <div className="space-y-4">
              {recentRuns.map((run) => (
                <div key={run.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
                      <code className="text-xs text-muted-foreground">{run.id.slice(0, 8)}</code>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">
                        {formatDatetime(run.run_at)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {durationMs(run.started_at, run.finished_at)}
                      </div>
                    </div>
                  </div>

                  {/* Step chips */}
                  {run.step_status && (
                    <div className="flex flex-wrap gap-1.5">
                      {STEPS.map((step) => (
                        <StepChip
                          key={step}
                          name={step}
                          entry={run.step_status?.[step] ?? null}
                        />
                      ))}
                    </div>
                  )}

                  {run.error && (
                    <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
                      {run.error}
                    </p>
                  )}

                  {/* Counters */}
                  {run.counters && Object.keys(run.counters).length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Counters
                      </summary>
                      <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-auto">
                        {JSON.stringify(run.counters, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
