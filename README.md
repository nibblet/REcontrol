# REcontrol - Admin Control Panel

REcontrol is the admin control panel for the RE:ecosystem. It provides system administrators with tools to manage workspaces, users, entitlements, and system-wide analytics.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4 + Shadcn/UI
- **Authentication**: Supabase Auth (SSR with cookies)
- **Database**: Supabase PostgreSQL (shared instance)
- **Theme**: next-themes (dark mode support)
- **Port**: 5001

## Getting Started

### Prerequisites

- Node.js 20+ installed
- Access to the shared Supabase instance

### Installation

```bash
# Navigate to REcontrol directory
cd /Volumes/Lexar/recontrol

# Install dependencies
npm install
```

### Environment Setup

The `.env.local` file is already configured with Supabase credentials:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://nubapahamhnvvppeusat.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
```

**Important**: The service role key is server-only and should never be exposed to the browser.

### Development

```bash
# Run development server
npm run dev

# Access at http://localhost:5001
```

### Build & Production

```bash
# Build for production
npm run build

# Start production server
npm run start
```

## Project Structure

```
recontrol/
├── app/
│   ├── layout.tsx              # Root layout with ThemeProvider
│   ├── page.tsx                # Landing (redirects based on auth)
│   ├── globals.css             # Tailwind CSS with theme variables
│   ├── auth/
│   │   └── page.tsx            # Sign in/sign up page
│   └── (dashboard)/
│       ├── layout.tsx          # Protected layout with auth check
│       └── dashboard/
│           └── page.tsx        # Main dashboard
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser client
│   │   ├── server.ts           # Server client
│   │   └── middleware.ts       # Session refresh middleware
│   └── utils.ts                # Utility functions
├── components/
│   ├── ui/                     # Shadcn UI components
│   └── theme-provider.tsx      # Theme provider
└── middleware.ts               # Route protection middleware
```

## Authentication Flow

1. User visits `http://localhost:5001`
2. If not authenticated → redirects to `/auth`
3. User signs in or creates account
4. On success → redirects to `/dashboard`
5. Dashboard shows user email, ID, and admin placeholder banner

## Current Features

- ✅ Supabase authentication (sign in/sign up)
- ✅ Protected routes (middleware + server-side checks)
- ✅ User info display (email, user ID)
- ✅ Admin check placeholder banner
- ✅ Dark mode support

## Next Steps (Not Yet Implemented)

### 1. Super Admin Check
**Priority**: High

Create `lib/admin/check.ts`:
```typescript
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .schema('core')
    .from('admin_users')
    .select('*')
    .eq('user_id', userId)
    .single()
  return !!data
}
```

Add to dashboard layout to restrict access to super admins only.

### 2. Workspace Management
**Location**: `app/(dashboard)/workspaces/`

Features:
- List all workspaces
- View workspace details and member counts
- Manage workspace entitlements
- View workspace usage metrics

**Reference Tables**:
- `core.workspaces`
- `core.workspace_members`
- `core.workspace_views`

### 3. User Management
**Location**: `app/(dashboard)/users/`

Features:
- List all users
- View user details and workspace memberships
- Assign/revoke workspace access
- Manage user roles (owner, editor, viewer)

**Reference Tables**:
- `auth.users`
- `core.users`
- `core.workspace_members`

### 4. Entitlement Management
**Location**: `app/(dashboard)/entitlements/`

Features:
- View all workspace entitlements
- Enable/disable apps (rebuild, readvise, redeal) per workspace
- View entitlement history

**Reference Table**: `core.workspace_views`

### 5. Usage Dashboard & Analytics
**Location**: `app/(dashboard)/analytics/`

Features:
- Active users per workspace/app
- API usage metrics
- Storage usage
- Generate reports

### 6. Admin RPCs (Server Routes)
**Location**: `app/api/admin/`

Create API routes for admin operations that require service role access.

**Example**:
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // Server-only!
)
```

## Database

REcontrol shares the Supabase PostgreSQL instance with other RE:ecosystem apps:

- **Shared Database**: `nubapahamhnvvppeusat.supabase.co`
- **Core Schema**: `core.*` (workspaces, users, entitlements)
- **Migration Locations**:
  - REbuild3: `/Volumes/Lexar/REbuild3/supabase/migrations/`
  - Readvise: `/Volumes/Lexar/readvise/supabase/migrations/`

Future REcontrol-specific migrations will go in `supabase/migrations/` when needed.

## Shared Utilities Reference

**Supabase Patterns** (from REbuild3):
- [lib/supabase/client.ts](/Volumes/Lexar/REbuild3/rebuild3/lib/supabase/client.ts)
- [lib/supabase/server.ts](/Volumes/Lexar/REbuild3/rebuild3/lib/supabase/server.ts)
- [lib/supabase/middleware.ts](/Volumes/Lexar/REbuild3/rebuild3/lib/supabase/middleware.ts)

**Component Library**:
```bash
npx shadcn@latest add <component-name>
```

**Type Generation**:
```bash
npx supabase gen types typescript --project-id nubapahamhnvvppeusat > types/supabase.ts
```

## Contributing

Follow REbuild3 patterns:
- Use Server Components by default
- Client components only when needed (`'use client'`)
- Schema scoping with `.schema('core')`
- Middleware for session refresh only
- Server-side auth checks in layouts

## License

Private - RE:ecosystem internal tool
