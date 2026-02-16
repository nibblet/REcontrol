'use client'

import { useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to console
    console.error('Application error:', error)

    // TODO: Log to error tracking service
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Application Error</CardTitle>
          <CardDescription>
            Something went wrong while processing your request.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p className="mb-2">Error details:</p>
            <code className="block p-3 bg-muted rounded text-xs overflow-auto">
              {error.message}
            </code>
            {error.digest && (
              <p className="mt-2 text-xs">
                Error ID: <code className="font-mono">{error.digest}</code>
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => window.location.href = '/dashboard'}
              className="flex-1"
            >
              Go to Dashboard
            </Button>
            <Button
              variant="default"
              onClick={reset}
              className="flex-1"
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
