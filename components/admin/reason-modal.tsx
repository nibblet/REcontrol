'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ReasonModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string | React.ReactNode
  onConfirm: (reason: string) => Promise<void> | void
  confirmText?: string
  confirmVariant?: 'default' | 'destructive'
}

export function ReasonModal({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmText = 'Confirm',
  confirmVariant = 'default',
}: ReasonModalProps) {
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    // Validate reason (minimum 10 characters)
    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      await onConfirm(reason.trim())
      // Reset on success
      setReason('')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    setReason('')
    setError('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild={typeof description !== 'string'}>
            {typeof description === 'string' ? <span>{description}</span> : description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Reason <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setError('')
              }}
              placeholder="Provide context for this action (minimum 10 characters)..."
              rows={4}
              disabled={isSubmitting}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {reason.trim().length} / 10 characters minimum
            </p>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={isSubmitting || reason.trim().length < 10}
          >
            {isSubmitting ? 'Processing...' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
