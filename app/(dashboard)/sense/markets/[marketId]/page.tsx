import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminGetSenseMarketDetail, type BootstrapRunRow } from '@/lib/admin/sense-queries'
import MarketActions from './MarketActions'

type Props = {
  params: Promise<{ marketId: string }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeVariant(status: string | null): 'default' | 'outline' | 'destructive' {
  if (status === 'available') return 'default'
  if (status === 'partial') return 'outline'
  return 'destructive'
}

function runBadgeVariant(status: string): 'default' | 'outline' | 'destructive' | 'secondary' {
  if (status === 'completed') return 'default'
  if (status === 'processing') return 'outline'
  if (status === 'failed') return 'destructive'
  return 'secondary'
}

function ingestBadgeVariant(status: string): 'default' | 'outline' | 'destructive' | 'secondary' {
  if (status === 'completed') return 'default'
  if (status === 'processing') return 'outline'
  if (status === 'failed') return 'destructive'
  return 'secondary'
}

function formatDatetime(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function formatDate(ts: string | null): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function durationMs(started: string | null, finished: string | null): string {
  if (!started || !finished) return '—'
  const ms = new Date(finished).getTime() - new Date(started).getTime()
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

const PIPELINE_STEPS = [
  'validate', 'tracts', 'crosswalk', 'acs', 'zillow', 'hud_safmr', 'snapshots', 'neighborhoods', 'publish',
] as const

type StepEntry = { status: string; started_at?: string; finished_at?: string; error?: string } | null

function StepChip({ name, entry }: { name: string; entry: StepEntry }) {
  if (!entry) {
    return (
      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded border border-border text-muted-foreground">
        {name}
      </span>
    )
  }

  const colorClass =
    entry.status === 'completed'
      ? 'bg-green-100 text-green-800 border-green-300'
      : entry.status === 'running'
      ? 'bg-blue-100 text-blue-800 border-blue-300'
      : entry.status === 'failed'
      ? 'bg-red-100 text-red-800 border-red-300'
      : 'bg-muted text-muted-foreground border-border'

  const icon =
    entry.status === 'completed' ? '✓' :
    entry.status === 'running' ? '⟳' :
    entry.status === 'failed' ? '✗' : '·'

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border ${colorClass}`}
      title={entry.error ?? `${name}: ${entry.status}${entry.started_at ? ` • ${durationMs(entry.started_at, entry.finished_at ?? null)}` : ''}`}
    >
      {icon} {name}
    </span>
  )
}

function CoverageDot({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  return value ? (
    <span className="text-green-600 font-medium">✓ Yes</span>
  ) : (
    <span className="text-muted-foreground">○ No</span>
  )
}

function FlagRow({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <CoverageDot value={value} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bootstrap run row — expanded view
// ---------------------------------------------------------------------------

function BootstrapRunCard({ run }: { run: BootstrapRunRow }) {
  const stepStatus = run.step_status ?? {}
  const hasError = run.status === 'failed' || Object.values(stepStatus).some((s) => s?.status === 'failed')
  const errorSteps = Object.entries(stepStatus).filter(([, s]) => s?.status === 'failed')
  const counters = run.counters ?? {}
  const hasCounters = Object.keys(counters).length > 0

  return (
    <div className={`border rounded-lg p-4 space-y-3 ${hasError ? 'border-destructive/40 bg-destructive/5' : ''}`}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
          <code className="text-xs text-muted-foreground font-mono">{run.id.slice(0, 8)}</code>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{formatDate(run.run_at)}</span>
          <span title={`${formatDatetime(run.started_at)} → ${formatDatetime(run.finished_at)}`}>
            ⏱ {durationMs(run.started_at, run.finished_at)}
          </span>
        </div>
      </div>

      {/* Step chips */}
      <div className="flex flex-wrap gap-1.5">
        {PIPELINE_STEPS.map((step) => (
          <StepChip
            key={step}
            name={step}
            entry={(stepStatus[step] as StepEntry) ?? null}
          />
        ))}
      </div>

      {/* Top-level error */}
      {run.error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5 font-mono">
          {run.error}
        </p>
      )}

      {/* Per-step errors */}
      {errorSteps.length > 0 && !run.error && (
        <div className="space-y-1">
          {errorSteps.map(([step, entry]) =>
            entry?.error ? (
              <p key={step} className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1 font-mono">
                [{step}] {entry.error}
              </p>
            ) : null
          )}
        </div>
      )}

      {/* Counters */}
      {hasCounters && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Counters
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(counters).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-mono">{k}</span>
                <span className="font-medium tabular-nums">{v?.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function MarketDetailPage({ params }: Props) {
  const { marketId } = await params
  const detail = await adminGetSenseMarketDetail(marketId)

  if (!detail) notFound()

  const { market, tractCount, countyCount, recentBootstrapRuns, recentZillowRuns, recentAcsRuns } = detail

  const lastSuccessfulRun = recentBootstrapRuns.find((r) => r.status === 'completed')
  const lastPublished = market.availability_updated_at

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/sense/markets" className="hover:text-foreground transition-colors">Markets</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{market.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            {market.name}
            {!market.enabled && (
              <Badge variant="secondary" className="text-sm">Disabled</Badge>
            )}
          </h1>
          <p className="text-muted-foreground font-mono text-sm mt-0.5">{market.market_key}</p>
          {market.cbsa_code && (
            <p className="text-xs text-muted-foreground">CBSA {market.cbsa_code}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={statusBadgeVariant(market.status)} className="text-sm px-3 py-1">
            {market.status ?? 'No data'}
          </Badge>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="text-center py-3">
          <p className="text-2xl font-bold tabular-nums">{tractCount.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Active tracts</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-2xl font-bold tabular-nums">{countyCount}</p>
          <p className="text-xs text-muted-foreground">Counties</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-sm font-bold">{formatDate(lastPublished)}</p>
          <p className="text-xs text-muted-foreground">Last published</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-sm font-bold">{lastSuccessfulRun ? formatDate(lastSuccessfulRun.run_at) : 'Never'}</p>
          <p className="text-xs text-muted-foreground">Last successful run</p>
        </Card>
      </div>

      {/* Coverage + Actions side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coverage flags */}
        <Card>
          <CardHeader>
            <CardTitle>Data Coverage</CardTitle>
            <CardDescription>Per-layer availability as of last publish</CardDescription>
          </CardHeader>
          <CardContent>
            <FlagRow label="Tracts loaded" value={market.has_tracts} />
            <FlagRow label="Geometry" value={market.has_geometry} />
            <FlagRow label="ACS 5-year projections" value={market.has_projections} />
            <FlagRow label="HPI (Zillow)" value={market.has_hpi} />
            <FlagRow label="Neighborhoods" value={market.has_neighborhoods} />
            <FlagRow label="HUD SAFMR" value={market.has_safmr} />
            {market.notes && (
              <p className="mt-3 text-xs text-muted-foreground italic">{market.notes}</p>
            )}
            {market.availability_updated_at && (
              <p className="mt-2 text-xs text-muted-foreground">
                Availability updated {formatDatetime(market.availability_updated_at)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
            <CardDescription>
              Bootstrap runs the full pipeline. Individual stages run only the selected step.
              Validate &amp; Publish is synchronous and returns the result immediately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MarketActions
              marketId={market.id}
              marketKey={market.market_key}
              enabled={market.enabled}
            />
          </CardContent>
        </Card>
      </div>

      {/* Bootstrap run timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Bootstrap Run Timeline</CardTitle>
          <CardDescription>
            {recentBootstrapRuns.length > 0
              ? `Last ${recentBootstrapRuns.length} runs — hover step chips for duration details`
              : 'No runs yet'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentBootstrapRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No bootstrap runs found. Run a Bootstrap to start.
            </p>
          ) : (
            <div className="space-y-3">
              {recentBootstrapRuns.map((run) => (
                <BootstrapRunCard key={run.id} run={run} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ingest run detail panels */}
      {(recentZillowRuns.length > 0 || recentAcsRuns.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Zillow / HPI runs */}
          {recentZillowRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>FHFA / Zillow Ingest Runs</CardTitle>
                <CardDescription>Last {recentZillowRuns.length} ingest attempts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentZillowRuns.map((run) => (
                    <div key={run.id} className="border rounded p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={ingestBadgeVariant(run.status)} className="text-xs">
                            {run.status}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">
                            {run.dataset}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {durationMs(run.started_at, run.finished_at)}
                        </span>
                      </div>
                      {run.rows_emitted != null && (
                        <p className="text-xs text-muted-foreground">
                          {run.rows_emitted.toLocaleString()} rows emitted
                          {run.rows_processed != null ? ` / ${run.rows_processed.toLocaleString()} processed` : ''}
                        </p>
                      )}
                      {run.error && (
                        <p className="text-xs text-destructive font-mono">{run.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ACS runs */}
          {recentAcsRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>ACS Ingest Runs</CardTitle>
                <CardDescription>Last {recentAcsRuns.length} ingest attempts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentAcsRuns.map((run) => (
                    <div key={run.id} className="border rounded p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={ingestBadgeVariant(run.status)} className="text-xs">
                            {run.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">ACS {run.year} 5yr</span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {durationMs(run.started_at, run.finished_at)}
                        </span>
                      </div>
                      {run.tracts_expected != null && (
                        <p className="text-xs text-muted-foreground">
                          {run.tracts_succeeded ?? 0}/{run.tracts_expected} tracts ok
                          {(run.tracts_failed ?? 0) > 0 ? ` · ${run.tracts_failed} failed` : ''}
                        </p>
                      )}
                      {run.error && (
                        <p className="text-xs text-destructive font-mono">{run.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
