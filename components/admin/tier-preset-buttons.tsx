'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ReasonModal } from './reason-modal'

interface TierPresetButtonsProps {
  workspaceId: string
  currentTier?: string
}

const TIER_INFO = {
  solo: {
    label: 'Solo',
    description: '1 seat, 1 market, 250K tokens, 50 pulls',
    color: 'text-gray-500',
    details: {
      seats: 1,
      markets: 1,
      advisor_tokens: 250000,
      property_fresh_pull: 50,
      photos_per_property: 30,
    },
  },
  team: {
    label: 'Team',
    description: '3 seats, 3 markets, 750K tokens, 250 pulls',
    color: 'text-blue-500',
    details: {
      seats: 3,
      markets: 3,
      advisor_tokens: 750000,
      property_fresh_pull: 250,
      photos_per_property: 30,
    },
  },
  pro: {
    label: 'Pro',
    description: '10 seats, 10 markets, 2M tokens, 1000 pulls',
    color: 'text-purple-500',
    details: {
      seats: 10,
      markets: 10,
      advisor_tokens: 2000000,
      property_fresh_pull: 1000,
      photos_per_property: 30,
    },
  },
}

export function TierPresetButtons({ workspaceId, currentTier }: TierPresetButtonsProps) {
  const [selectedTier, setSelectedTier] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleTierChange = async (reason: string) => {
    if (!selectedTier) return

    setIsLoading(true)

    try {
      const response = await fetch(`/api/admin/workspaces/${workspaceId}/tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selectedTier, reason }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update tier')
      }

      // Success - refresh the page to show updated data
      router.refresh()
    } catch (error) {
      throw error // Let ReasonModal handle the error display
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(TIER_INFO).map(([tier, info]) => (
          <Button
            key={tier}
            variant={currentTier === tier ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedTier(tier)}
            disabled={isLoading || currentTier === tier}
            className="flex-1 min-w-[140px]"
          >
            <span className={info.color}>{info.label}</span>
            {currentTier === tier && (
              <Badge variant="secondary" className="ml-2">
                Current
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {selectedTier && (
        <ReasonModal
          open={selectedTier !== null}
          onOpenChange={(open) => !open && setSelectedTier(null)}
          title={`Apply ${TIER_INFO[selectedTier as keyof typeof TIER_INFO].label} Tier Preset`}
          description={
            <div className="space-y-3">
              <p>
                This will update entitlements for all apps (RE:advise, RE:build, RE:deal) to the{' '}
                <strong>{TIER_INFO[selectedTier as keyof typeof TIER_INFO].label}</strong> tier.
              </p>
              <div className="bg-muted p-3 rounded-lg text-sm">
                <p className="font-semibold mb-2">New limits:</p>
                <ul className="space-y-1 text-xs">
                  <li>• Seats: {TIER_INFO[selectedTier as keyof typeof TIER_INFO].details.seats}</li>
                  <li>• Markets: {TIER_INFO[selectedTier as keyof typeof TIER_INFO].details.markets}</li>
                  <li>• Tokens/month: {TIER_INFO[selectedTier as keyof typeof TIER_INFO].details.advisor_tokens.toLocaleString()}</li>
                  <li>• Fresh pulls/month: {TIER_INFO[selectedTier as keyof typeof TIER_INFO].details.property_fresh_pull}</li>
                  <li>• Photos per property: {TIER_INFO[selectedTier as keyof typeof TIER_INFO].details.photos_per_property}</li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                This action will be logged in the audit trail.
              </p>
            </div>
          }
          onConfirm={handleTierChange}
          confirmText="Apply Preset"
        />
      )}
    </div>
  )
}
