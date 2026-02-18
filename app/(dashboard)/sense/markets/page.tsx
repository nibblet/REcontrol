import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminListSenseMarkets } from '@/lib/admin/sense-queries'

function statusBadgeVariant(status: string | null): 'default' | 'outline' | 'destructive' {
  if (status === 'available') return 'default'
  if (status === 'partial') return 'outline'
  return 'destructive'
}

function statusLabel(status: string | null): string {
  if (!status) return 'No data'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function CoverageFlag({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return <span className="text-muted-foreground text-xs">{label}: —</span>
  return (
    <span className={`text-xs ${value ? 'text-green-600' : 'text-muted-foreground'}`}>
      {value ? '✓' : '○'} {label}
    </span>
  )
}

function formatDate(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString()
}

export default async function SenseMarketsPage() {
  const markets = await adminListSenseMarkets()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sense Markets</h1>
          <p className="text-muted-foreground">
            {markets.length} market{markets.length !== 1 ? 's' : ''} registered
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => (
            <Link key={market.id} href={`/sense/markets/${market.id}`} className="block">
              <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{market.name}</CardTitle>
                    <Badge variant={statusBadgeVariant(market.status)} className="shrink-0">
                      {statusLabel(market.status)}
                    </Badge>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">{market.market_key}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <CoverageFlag label="Tracts" value={market.has_tracts} />
                    <CoverageFlag label="Geometry" value={market.has_geometry} />
                    <CoverageFlag label="ACS" value={market.has_projections} />
                    <CoverageFlag label="HPI" value={market.has_hpi} />
                    <CoverageFlag label="Neighborhoods" value={market.has_neighborhoods} />
                    <CoverageFlag label="SAFMR" value={market.has_safmr} />
                  </div>
                  {market.availability_updated_at && (
                    <p className="text-xs text-muted-foreground">
                      Updated {formatDate(market.availability_updated_at)}
                    </p>
                  )}
                  {market.notes && (
                    <p className="text-xs text-muted-foreground italic">{market.notes}</p>
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
