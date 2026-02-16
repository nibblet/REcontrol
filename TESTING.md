# REcontrol Testing Guide

## Overview

This guide covers testing procedures for REcontrol, the super-admin control panel for the RE:ecosystem.

## Prerequisites

- Super admin access (user with `platform_role = 'super_admin'`)
- At least one test workspace in the database
- REbuild3 supabase migrations applied

## Manual Testing Checklist

### Authentication & Authorization

- [ ] **Non-admin users redirected**
  - Sign in with a regular user (no `super_admin` role)
  - Verify redirect to `/unauthorized` page
  - Confirm friendly error message displayed

- [ ] **Super admin access granted**
  - Sign in with super admin user
  - Verify access to `/dashboard`
  - Confirm all navigation links visible

### Dashboard

- [ ] **MTD Stats Display**
  - Verify 3 stat cards showing: Tokens, Fresh Pulls, Sense Runs
  - Check `metric-glow` effect on numbers
  - Confirm subtitle text displays correctly

- [ ] **Top Workspaces List**
  - Verify workspaces sorted by token usage
  - Click workspace → redirects to detail page
  - Check "View All" button → redirects to workspaces list

- [ ] **Anomaly Detection**
  - If no anomalies: "All Systems Normal" card shows
  - If anomalies exist: Alert card shows with count
  - Verify severity badges (warning/critical)
  - Click workspace link → redirects to detail page

- [ ] **Quick Actions**
  - All 4 buttons present and clickable
  - Navigate to each section successfully

### Workspaces Management

- [ ] **Workspaces List**
  - All workspaces display in table
  - Search by name works (live filtering)
  - Search by email works
  - Search by ID works
  - Tier badges color-coded correctly (Solo=gray, Team=blue, Pro=purple)
  - Member count displays
  - Click row → navigates to detail page

- [ ] **Workspace Detail - Read-Only**
  - Summary card shows owner, created date
  - Usage panel shows MTD vs limits
  - Progress bars color-coded: green (<75%), amber (75-90%), red (≥90%)
  - 30-day usage chart displays (currently mock data)
  - Entitlements panel shows all apps
  - Members list displays with roles

- [ ] **Tier Change Operation**
  - Click Solo/Team/Pro button
  - Reason modal appears
  - Enter reason <10 chars → Error "Reason must be at least 10 characters"
  - Enter valid reason (≥10 chars)
  - Click "Apply Preset"
  - Page refreshes → tier updated for all apps
  - Navigate to Audit Log → action logged with before/after state

- [ ] **App Toggle Operation**
  - Toggle app switch
  - Reason modal appears
  - Enter valid reason
  - Confirm → app enabled/disabled
  - Page refreshes → status updated
  - Navigate to Audit Log → action logged

### Sense Operations

- [ ] **Markets Overview**
  - Market cards display for each market
  - Status indicators correct: 🟢 Active (≥95%), 🟡 Partial (75-95%), 🔴 Down (<75%)
  - Last run time shows relative format ("5m ago")
  - 24h success rate displays with `metric-glow`

- [ ] **Recent Job Runs**
  - Runs listed per market
  - Status badges color-coded (success=green, partial=yellow, failed=red)
  - Task counts show (successful/total)
  - Error summaries expandable for failed runs

### Audit Log

- [ ] **Audit Log Display**
  - All admin actions listed
  - Newest first (reverse chronological)
  - Actor email displays
  - Workspace name displays
  - Action type badges color-coded
  - Reason text visible
  - Relative timestamps ("5m ago", "2h ago")

- [ ] **Changes Diff Viewer**
  - Click "View changes" → expands
  - Before/after JSON shown side-by-side
  - JSON properly formatted
  - Changed fields highlighted

- [ ] **Audit Log Metadata**
  - IP address captured
  - User agent captured
  - Audit ID visible

### Rate Limiting

- [ ] **Rate Limit Enforcement**
  - Make 10 tier changes rapidly
  - 11th request → "Rate limit exceeded" error
  - Wait 60 seconds
  - Next request succeeds

### Error Handling

- [ ] **Client-Side Errors**
  - Force a client error (e.g., invalid JSON)
  - Error boundary catches and displays friendly message
  - "Try Again" button resets component
  - "Reload Page" button refreshes

- [ ] **Server-Side Errors**
  - Trigger server error (e.g., invalid workspace ID)
  - Error page displays
  - Error message shown
  - "Go to Dashboard" button works

### Indigo Blueprint Aesthetic

- [ ] **Color Scheme**
  - Deep indigo primary color throughout
  - Amber accents visible (logo gradient, charts)
  - Chart colors: blue, green, amber, purple, red

- [ ] **Blueprint Grid Background**
  - Subtle grid visible on all pages
  - Grid more prominent in dark mode

- [ ] **Metric Glow Effects**
  - Numbers glow on hover/display
  - Visible on: MTD stats, top workspaces, sense success rates

- [ ] **Typography**
  - Monospace for: IDs, metrics, codes
  - Sans-serif for labels and body text

### Performance

- [ ] **Page Load Times**
  - Dashboard loads <2s
  - Workspaces list loads <2s
  - Workspace detail loads <2s
  - Sense ops loads <2s
  - Audit log loads <2s

- [ ] **Navigation**
  - Header sticky on scroll
  - Nav links highlight on hover
  - Page transitions smooth

## RPC-Level Testing (Supabase)

Run these queries directly in Supabase SQL editor:

### Test is_super_admin()

```sql
-- Should return true for super admins
SELECT core.is_super_admin();

-- Test with non-admin user (run as different user)
SELECT core.is_super_admin(); -- Should return false
```

### Test admin_set_workspace_tier()

```sql
-- Should succeed for super admins
SELECT core.admin_set_workspace_tier(
  'workspace-id-here',
  'team',
  'Testing tier change via SQL',
  '127.0.0.1',
  'Test User Agent'
);

-- Verify audit log entry created
SELECT * FROM core.admin_audit_log
WHERE action = 'set_workspace_tier'
ORDER BY created_at DESC
LIMIT 1;
```

### Test admin_set_app_enabled()

```sql
-- Should succeed for super admins
SELECT core.admin_set_app_enabled(
  'workspace-id-here',
  'readvise',
  false,
  'Testing app disable via SQL',
  '127.0.0.1',
  'Test User Agent'
);

-- Verify audit log entry created
SELECT * FROM core.admin_audit_log
WHERE action = 'set_app_enabled'
ORDER BY created_at DESC
LIMIT 1;
```

### Test Audit Log Query

```sql
-- Should return audit log entries for super admins
SELECT * FROM core.admin_get_audit_log(
  NULL, -- workspace_id
  NULL, -- action
  50,   -- limit
  0     -- offset
);
```

## Integration Testing

### End-to-End Tier Change Flow

1. Navigate to workspace detail page
2. Click "Pro" tier button
3. Enter reason: "Upgrading to Pro for testing"
4. Click "Apply Preset"
5. Verify page refreshes
6. Check all apps show "pro" tier
7. Navigate to Audit Log
8. Verify entry exists with:
   - Action: set_workspace_tier
   - Before state: previous tier
   - After state: pro tier
   - Reason: matches input

### End-to-End App Toggle Flow

1. Navigate to workspace detail page
2. Find an enabled app
3. Click toggle switch
4. Enter reason: "Testing app disable"
5. Click "Disable App"
6. Verify page refreshes
7. Check app shows "Disabled" badge
8. Navigate to Audit Log
9. Verify entry exists

## Regression Testing

Before each release, run through:

1. ✅ Authentication (admin & non-admin)
2. ✅ Dashboard metrics display
3. ✅ Tier change operation
4. ✅ App toggle operation
5. ✅ Audit log viewing
6. ✅ Rate limiting (make 11 requests)
7. ✅ Error boundaries (force an error)

## Known Limitations

- Usage chart data is mock (no historical data yet)
- Anomaly detection only checks sense failures (no workspace usage spikes implemented yet)
- Rate limiting is in-memory (resets on server restart)
- No email notifications on tier changes (planned)

## Reporting Issues

When reporting issues, include:

1. User email and ID
2. Workspace ID (if applicable)
3. Steps to reproduce
4. Expected vs actual behavior
5. Browser console errors (if any)
6. Audit log entry ID (if applicable)
