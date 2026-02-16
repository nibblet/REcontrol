'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Switch } from '@/components/ui/switch'
import { ReasonModal } from './reason-modal'

interface AppToggleProps {
  workspaceId: string
  app: string
  enabled: boolean
  disabled?: boolean
}

export function AppToggle({ workspaceId, app, enabled, disabled }: AppToggleProps) {
  const [showReasonModal, setShowReasonModal] = useState(false)
  const [pendingState, setPendingState] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleToggle = (checked: boolean) => {
    setPendingState(checked)
    setShowReasonModal(true)
  }

  const handleConfirm = async (reason: string) => {
    if (pendingState === null) return

    setIsLoading(true)

    try {
      const response = await fetch(`/api/admin/workspaces/${workspaceId}/app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app,
          enabled: pendingState,
          reason,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update app status')
      }

      // Success - refresh the page
      router.refresh()
      setPendingState(null)
    } catch (error) {
      setPendingState(null)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <Switch
        checked={enabled}
        onCheckedChange={handleToggle}
        disabled={disabled || isLoading}
      />

      {pendingState !== null && (
        <ReasonModal
          open={showReasonModal}
          onOpenChange={(open) => {
            setShowReasonModal(open)
            if (!open) setPendingState(null)
          }}
          title={`${pendingState ? 'Enable' : 'Disable'} ${app.charAt(0).toUpperCase() + app.slice(1)}`}
          description={`You are about to ${pendingState ? 'enable' : 'disable'} RE:${app} for this workspace. This action will be logged.`}
          onConfirm={handleConfirm}
          confirmText={pendingState ? 'Enable App' : 'Disable App'}
          confirmVariant={pendingState ? 'default' : 'destructive'}
        />
      )}
    </>
  )
}
