import * as React from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth')
  }

  // Check super_admin role using RPC
  const { data: isSuperAdmin, error } = await supabase
    .schema('core')
    .rpc('is_super_admin')

  if (error || !isSuperAdmin) {
    redirect('/unauthorized')
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="flex h-16 items-center px-4 container mx-auto">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              REcontrol
            </h1>
            <nav className="hidden md:flex items-center gap-4 text-sm">
              <a
                href="/dashboard"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Dashboard
              </a>
              <a
                href="/workspaces"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Workspaces
              </a>
              <a
                href="/sense"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Sense Ops
              </a>
              <a
                href="/audit"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Audit Log
              </a>
            </nav>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {user.email}
            </span>
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto p-4 md:p-6 lg:p-8">
        {children}
      </main>
    </div>
  )
}
