'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { approveMarketRequest, rejectMarketRequest } from '@/lib/actions/sense'
import { useRouter } from 'next/navigation'

type Props = {
  requestId: string
  resolvedMarketKey: string | null
  currentStatus: string
}

export default function RequestActions({ requestId, resolvedMarketKey, currentStatus }: Props) {
  const router = useRouter()
  const [approveState, setApproveState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [rejectState, setRejectState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const isFinal = currentStatus === 'planned' || currentStatus === 'shipped' || currentStatus === 'closed'
  if (isFinal) {
    return <span className="text-xs text-muted-foreground italic">No actions — {currentStatus}</span>
  }

  async function handleApprove() {
    setApproveState('loading')
    setError(null)
    const result = await approveMarketRequest(requestId, resolvedMarketKey ?? undefined)
    if (result.ok) {
      setApproveState('ok')
      router.refresh()
    } else {
      setApproveState('error')
      setError(result.error)
    }
  }

  async function handleReject() {
    const note = prompt('Rejection note (optional):') ?? undefined
    if (note === undefined) return // cancelled
    setRejectState('loading')
    setError(null)
    const result = await rejectMarketRequest(requestId, note || undefined)
    if (result.ok) {
      setRejectState('ok')
      router.refresh()
    } else {
      setRejectState('error')
      setError(result.error)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={handleApprove}
        disabled={approveState === 'loading' || approveState === 'ok'}
      >
        {approveState === 'loading' ? '…' : approveState === 'ok' ? '✓' : 'Approve'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleReject}
        disabled={rejectState === 'loading' || rejectState === 'ok'}
      >
        {rejectState === 'loading' ? '…' : rejectState === 'ok' ? '✓' : 'Reject'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
