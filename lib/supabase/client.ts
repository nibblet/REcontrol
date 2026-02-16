import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Future: Add schema-specific clients (core, recontrol)
export const getCoreClient = () => {
  const client = createClient()
  return client.schema('core')
}
