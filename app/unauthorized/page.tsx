import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md border-destructive">
        <CardHeader>
          <CardTitle className="text-2xl">Access Denied</CardTitle>
          <CardDescription>
            You do not have permission to access REcontrol.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            REcontrol is the super-admin control panel for the RE:ecosystem. Only users with
            <code className="mx-1 px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
              super_admin
            </code>
            platform role can access this panel.
          </p>
          <p className="text-sm text-muted-foreground">
            If you believe you should have access, please contact your system administrator.
          </p>
          <div className="pt-4">
            <Link href="/auth">
              <Button variant="outline" className="w-full">
                Return to Sign In
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
