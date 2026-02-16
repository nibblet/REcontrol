# REcontrol Operator Runbook

## Quick Reference

- **Production URL**: `https://your-domain.com/dashboard`
- **Database**: Supabase (shared core schema)
- **Auth**: Supabase Auth with `platform_role = super_admin`
- **Rate Limit**: 10 writes/minute per admin

## Common Operations

### 1. Granting Super Admin Access

**When**: A new team member needs admin access to REcontrol

**Steps**:
```sql
-- Connect to production database
-- Update user's platform_role

UPDATE core.users
SET platform_role = 'super_admin'
WHERE email = 'new-admin@example.com';

-- Verify
SELECT id, email, platform_role
FROM core.users
WHERE email = 'new-admin@example.com';
```

**Verification**:
- New admin can sign in to REcontrol
- Non-admin users still redirected to unauthorized page

---

### 2. Upgrading a Workspace Tier

**When**: Customer upgrades from Solo → Team or Team → Pro

**UI Method** (Recommended):
1. Navigate to `/dashboard/workspaces`
2. Search for workspace by name or email
3. Click workspace row → detail page
4. In "Apply Tier Preset" section, click desired tier (Solo/Team/Pro)
5. Enter reason: "Customer upgrade request from [source]"
6. Click "Apply Preset"
7. Verify all apps show new tier

**SQL Method** (If UI unavailable):
```sql
SELECT core.admin_set_workspace_tier(
  'workspace-uuid-here',
  'pro', -- solo, team, or pro
  'Customer upgrade via support ticket #12345',
  '127.0.0.1',
  'Manual SQL execution'
);

-- Verify in audit log
SELECT * FROM core.admin_audit_log
WHERE action = 'set_workspace_tier'
AND workspace_id = 'workspace-uuid-here'
ORDER BY created_at DESC
LIMIT 1;
```

**Tier Limits**:
- **Solo**: 1 seat, 1 market, 250K tokens/mo, 50 pulls/mo
- **Team**: 3 seats, 3 markets, 750K tokens/mo, 250 pulls/mo
- **Pro**: 10 seats, 10 markets, 2M tokens/mo, 1000 pulls/mo

---

### 3. Disabling an App for a Workspace

**When**: Customer requests to disable RE:build or RE:deal temporarily

**UI Method**:
1. Navigate to workspace detail page
2. Scroll to "App Entitlements" section
3. Find the app to disable (RE:advise, RE:build, RE:deal)
4. Click the toggle switch
5. Enter reason: "Customer request - [reason]"
6. Click "Disable App"

**SQL Method**:
```sql
SELECT core.admin_set_app_enabled(
  'workspace-uuid-here',
  'rebuild', -- readvise, rebuild, or redeal
  false, -- true to enable, false to disable
  'Customer requested app suspension',
  '127.0.0.1',
  'Manual SQL execution'
);
```

**Impact**:
- Users in workspace lose access to that app
- Usage limits for that app no longer enforced
- Data remains in database (no deletion)

---

### 4. Investigating High Usage

**When**: Workspace approaching or exceeding usage limits

**Steps**:
1. Navigate to `/dashboard`
2. Check "Top Workspaces by Token Usage" card
3. Click workspace → detail page
4. Review "Usage (MTD)" panel:
   - Green bar (<75%): Normal usage
   - Amber bar (75-90%): Approaching limit
   - Red bar (≥90%): At/over limit
5. Check "30-Day Usage Trend" chart for patterns

**SQL Method**:
```sql
-- Get MTD usage for specific workspace
SELECT core.admin_get_usage_summary(
  'workspace-uuid-here',
  DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')::date
);

-- Get top 10 workspaces by token usage this month
SELECT core.admin_list_top_usage(
  'advisor_tokens',
  DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')::date,
  10
);
```

**Actions**:
- Contact workspace owner about upgrade
- Temporarily increase limits (manual override)
- Monitor for abuse/anomalies

---

### 5. Monitoring Sense Operations

**When**: Checking market data pipeline health

**UI Method**:
1. Navigate to `/dashboard/sense`
2. Review market status cards:
   - 🟢 Active (≥95% success): Healthy
   - 🟡 Partial (75-95% success): Degraded
   - 🔴 Down (<75% success): Critical
3. Check "Recent Job Runs" for error details

**Interpreting Status**:
- **Success Rate**: Percentage of tasks completed successfully in last 24h
- **Last Run**: Time since most recent job execution
- **Error Summary**: Click failed runs to view error details

**Troubleshooting**:
- If market down: Check external data provider status
- If partial: Review error summaries for patterns
- If jobs not running: Check RE:sense cron/scheduler

---

### 6. Reviewing Audit Log

**When**: Investigating admin action, compliance audit, or issue investigation

**UI Method**:
1. Navigate to `/dashboard/audit`
2. Review recent actions (sorted newest first)
3. Use filters (upcoming feature) to narrow down:
   - By workspace
   - By action type
   - By date range
4. Click "View changes" to see before/after JSON diff

**SQL Method**:
```sql
-- Get all audit log entries for a workspace
SELECT * FROM core.admin_get_audit_log(
  'workspace-uuid-here', -- workspace filter
  NULL, -- action filter (NULL = all)
  100, -- limit
  0 -- offset
);

-- Get all tier changes in last 7 days
SELECT * FROM core.admin_audit_log
WHERE action = 'set_workspace_tier'
AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

**Audit Log Fields**:
- **Actor**: Super admin who performed action
- **Workspace**: Affected workspace
- **Action**: Type of operation
- **Before/After State**: JSON snapshots
- **Reason**: Operator-provided context
- **IP Address**: Client IP
- **Timestamp**: When action occurred

---

## Incident Response

### Rate Limit Exceeded

**Symptom**: Admin reports "Rate limit exceeded" error

**Cause**: More than 10 write operations in 1 minute

**Resolution**:
1. Wait 60 seconds for window to reset
2. Retry operation
3. If persistent: Check for automation/scripts hitting API

**Prevention**:
- Batch operations when possible
- Use tier presets instead of individual app toggles

---

### Workspace Not Updating

**Symptom**: Tier change or app toggle not reflected after refresh

**Diagnosis**:
1. Check audit log for operation
2. If logged: Verify RPC succeeded (check `after_state`)
3. If not logged: Check browser console for errors

**Resolution**:
```sql
-- Manually verify current state
SELECT * FROM core.workspace_entitlements
WHERE workspace_id = 'workspace-uuid-here';

-- If stuck, manually apply tier preset
SELECT core.admin_set_workspace_tier(
  'workspace-uuid-here',
  'desired-tier',
  'Manual fix for stuck state',
  '127.0.0.1',
  'Operator runbook'
);
```

---

### Unauthorized Access Error

**Symptom**: Super admin redirected to `/unauthorized` page

**Diagnosis**:
```sql
-- Check user's platform_role
SELECT id, email, platform_role
FROM core.users
WHERE email = 'admin@example.com';
```

**Resolution**:
```sql
-- Grant super_admin role if missing
UPDATE core.users
SET platform_role = 'super_admin'
WHERE email = 'admin@example.com';
```

---

### Sense Market Down

**Symptom**: Market showing 🔴 Down status (<75% success rate)

**Diagnosis**:
1. Navigate to `/dashboard/sense`
2. Check specific market's recent runs
3. Expand error summaries for failed runs

**Common Causes**:
- External data provider outage
- API rate limits exceeded
- Invalid credentials/auth
- Network connectivity issues

**Resolution**:
1. Check external provider status page
2. Review API credentials/tokens
3. Check RE:sense job logs for details
4. Contact RE:sense team if persistent

---

## Security

### Super Admin Role Assignment

**Best Practices**:
- Only grant `super_admin` to trusted team members
- Review super admin list quarterly
- Use individual accounts (no shared credentials)
- Require MFA for all super admins

**Current Super Admins**:
```sql
SELECT id, email, created_at
FROM core.users
WHERE platform_role = 'super_admin'
ORDER BY created_at;
```

---

### Audit Log Retention

**Current Policy**: Indefinite retention

**Recommended**:
- Archive logs older than 1 year
- Export to cold storage quarterly
- Retain critical actions (tier changes, app disables) for 7 years

---

## Maintenance

### Monthly Tasks

- [ ] Review audit log for anomalies
- [ ] Check top usage workspaces
- [ ] Verify all markets healthy
- [ ] Review super admin list

### Quarterly Tasks

- [ ] Archive old audit logs (>1 year)
- [ ] Review and update tier limits
- [ ] Update this runbook with new procedures

---

## Emergency Contacts

- **REcontrol Issues**: [Your team Slack channel]
- **Database Issues**: [DBA contact]
- **Supabase Support**: [support@supabase.io]
- **RE:sense Team**: [Sense team contact]

---

## Appendix: Common SQL Queries

### Get All Workspaces

```sql
SELECT * FROM core.admin_list_workspaces(
  NULL, -- search
  100, -- limit
  0 -- offset
);
```

### Get Workspace Usage Summary

```sql
SELECT core.admin_get_usage_summary(
  'workspace-uuid-here',
  DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')::date
);
```

### Get Top Usage Workspaces

```sql
-- Top 10 by advisor tokens
SELECT core.admin_list_top_usage('advisor_tokens', NULL, 10);

-- Top 10 by fresh pulls
SELECT core.admin_list_top_usage('property_fresh_pull', NULL, 10);

-- Top 10 by sense runs
SELECT core.admin_list_top_usage('sense_run', NULL, 10);
```

### Get Sense Ops Summary

```sql
SELECT * FROM core.admin_get_sense_ops_summary();
```

### Search Audit Log

```sql
-- By workspace
SELECT * FROM core.admin_get_audit_log('workspace-uuid-here', NULL, 50, 0);

-- By action
SELECT * FROM core.admin_get_audit_log(NULL, 'set_workspace_tier', 50, 0);

-- Recent 100 actions
SELECT * FROM core.admin_get_audit_log(NULL, NULL, 100, 0);
```
