import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminListSenseMarkets } from '@/lib/admin/sense-queries'

function availabilityBadgeVariant(status: string | null): 'default' | 'outline' | 'destructive' {
  if (status === 'available') return 'default'
  if (status === 'partial') return 'outline'
  return 'destructive'
}

function coverageScore(market: {
  has_tracts: boolean | null
  has_geometry: boolean | null
  has_projections: boolean | null
  has_hpi: boolean | null
  has_neighborhoods: boolean | null
  has_safmr: boolean | null
}): string {
  const flags = [
    market.has_tracts,
    market.has_geometry,
    market.has_projections,
    market.has_hpi,
    market.has_neighborhoods,
    market.has_safmr,
  ]
  if (flags.every((f) => f === null)) return '—'
  const yes = flags.filter(Boolean).length
  const total = flags.filter((f) => f !== null).length
  return `${yes}/${total}`
}

function formatDate(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CoverageFlag({ value, label }: { value: boolean | null; label: string }) {
  return (
    <span
      className={`text-xs ${value ? 'text-green-600' : value === false ? 'text-muted-foreground/50' : 'text-muted-foreground/30'}`}
      title={label}
    >
      {value ? '●' : '○'}
    </span>
  )
}

export default async function SenseMarketsPage() {
  const markets = await adminListSenseMarkets()
  const enabledCount = markets.filter((m) => m.enabled).length
  const availableCount = markets.filter((m) => m.status === 'available').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sense Markets</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {markets.length} market{markets.length !== 1 ? 's' : ''} ·{' '}
            {enabledCount} enabled ·{' '}
            {availableCount} available
          </p>
        </div>
      </div>

      {markets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No markets found. Seed core.sense_markets to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => (
            <Link key={market.id} href={`/sense/markets/${market.id}`} className="block group">
              <Card className={`h-full transition-colors group-hover:border-primary/50 ${!market.enabled ? 'opacity-60' : ''}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base leading-snug truncate">{market.name}</CardTitle>
                      <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">
                        {market.market_key}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant={availabilityBadgeVariant(market.status)} className="text-xs">
                        {market.status ?? 'No data'}
                      </Badge>
                      {!market.enabled && (
                        <Badge variant="secondary" className="text-xs">Disabled</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Coverage dots — Tracts · Geo · ACS · HPI · Neigh · SAFMR */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Coverage</span>
                    <div className="flex gap-0.5">
                      <CoverageFlag value={market.has_tracts}       label="Tracts" />
                      <CoverageFlag value={market.has_geometry}      label="Geometry" />
                      <CoverageFlag value={market.has_projections}   label="ACS" />
                      <CoverageFlag value={market.has_hpi}           label="HPI" />
                      <CoverageFlag value={market.has_neighborhoods} label="Neighborhoods" />
                      <CoverageFlag value={market.has_safmr}         label="SAFMR" />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground ml-auto">
                      {coverageScore(market)}
                    </span>
                  </div>

                  {/* Last published */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Last published</span>
                    <span className="font-mono">
                      {market.availability_updated_at ? formatDate(market.availability_updated_at) : 'Never'}
                    </span>
                  </div>

                  {market.notes && (
                    <p className="text-xs text-muted-foreground italic truncate">{market.notes}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
