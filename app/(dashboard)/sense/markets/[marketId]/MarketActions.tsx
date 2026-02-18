'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { triggerBootstrap, validateMarket, publishMarket } from '@/lib/actions/sense'
import { useRouter } from 'next/navigation'

type Props = {
  marketId: string
  marketKey: string
}

export default function MarketActions({ marketId, marketKey }: Props) {
  const router = useRouter()
  const [bootstrapState, setBootstrapState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [validateState, setValidateState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [publishState, setPublishState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [validateResult, setValidateResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleBootstrap() {
    setBootstrapState('loading')
    setError(null)
    const result = await triggerBootstrap(marketKey)
    if (result.ok) {
      setBootstrapState('ok')
      setTimeout(() => {
        setBootstrapState('idle')
        router.refresh()
      }, 2000)
    } else {
      setBootstrapState('error')
      setError(result.error)
    }
  }

  async function handleValidate() {
    setValidateState('loading')
    setError(null)
    setValidateResult(null)
    const result = await validateMarket(marketKey)
    if (result.ok) {
      setValidateState('ok')
      setValidateResult(result.result)
    } else {
      setValidateState('error')
      setError(result.error)
    }
  }

  async function handlePublish() {
    if (!confirm(`Publish ${marketKey} as available?`)) return
    setPublishState('loading')
    setError(null)
    const result = await publishMarket(marketId)
    if (result.ok) {
      setPublishState('ok')
      setTimeout(() => {
        setPublishState('idle')
        router.refresh()
      }, 1500)
    } else {
      setPublishState('error')
      setError(result.error)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={handleBootstrap}
          disabled={bootstrapState === 'loading'}
          variant="default"
        >
          {bootstrapState === 'loading'
            ? 'Triggering…'
            : bootstrapState === 'ok'
            ? '✓ Bootstrap queued'
            : 'Run Bootstrap'}
        </Button>

        <Button
          onClick={handleValidate}
          disabled={validateState === 'loading'}
          variant="outline"
        >
          {validateState === 'loading'
            ? 'Validating…'
            : validateState === 'ok'
            ? '✓ Done'
            : 'Validate'}
        </Button>

        <Button
          onClick={handlePublish}
          disabled={publishState === 'loading'}
          variant="outline"
        >
          {publishState === 'loading'
            ? 'Publishing…'
            : publishState === 'ok'
            ? '✓ Published'
            : 'Publish'}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
      )}

      {validateResult && (
        <details open className="text-sm">
          <summary className="cursor-pointer font-medium mb-2">Validation Result</summary>
          <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-64">
            {JSON.stringify(validateResult, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
