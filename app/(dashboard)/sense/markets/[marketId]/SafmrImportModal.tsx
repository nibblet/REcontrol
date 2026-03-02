'use client'

import { useState, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { importSafmr } from '@/lib/actions/sense'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  marketKey: string
  marketName: string
  onSuccess?: () => void
}

export function SafmrImportModal({
  open,
  onOpenChange,
  marketKey,
  marketName,
  onSuccess,
}: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [fyYear, setFyYear] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    setFile(f ?? null)
    setError('')
  }

  const handleSubmit = async () => {
    if (!file) {
      setError('Please select an XLSX file')
      return
    }
    setIsSubmitting(true)
    setError('')
    const formData = new FormData()
    formData.append('marketKey', marketKey)
    formData.append('file', file, file.name)
    if (fyYear.trim()) formData.append('safmrFyYear', fyYear.trim())

    const result = await importSafmr(formData)
    if (result.ok) {
      setFile(null)
      setFyYear('')
      onOpenChange(false)
      onSuccess?.()
    } else {
      setError(result.error)
    }
    setIsSubmitting(false)
  }

  const handleCancel = () => {
    setFile(null)
    setFyYear('')
    setError('')
    onOpenChange(false)
    inputRef.current?.value && (inputRef.current.value = '')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import HUD SAFMR</DialogTitle>
          <DialogDescription>
            Upload the SAFMR XLSX file for <strong>{marketName}</strong>. The file will be sent to readvise to run the HUD SAFMR ingest stage. Works in production (no server file path needed).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              XLSX file <span className="text-destructive">*</span>
            </label>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-sm"
            />
            {file && (
              <p className="text-xs text-muted-foreground mt-1">
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              FY year <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 2026"
              value={fyYear}
              onChange={(e) => setFyYear(e.target.value)}
              disabled={isSubmitting}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !file}>
            {isSubmitting ? 'Importing…' : 'Import & run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
