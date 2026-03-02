# REcontrol Operator Runbook

**Implementation plan (bootstrap + onboarding):** See [docs/SENSE_BOOTSTRAP_AND_ONBOARDING_PLAN.md](docs/SENSE_BOOTSTRAP_AND_ONBOARDING_PLAN.md) for a full review of the request flow and bootstrap process, root causes of silent snapshots/aggregation failures, and a phased plan to add debugging, fix behavior, and onboard Frankfort (then repeat for new markets).

## Quick Reference

- **Production URL**: `https://your-domain.com/dashboard`
- **Database**: Supabase (shared core schema)
- **Auth**: Supabase Auth with `platform_role = super_admin`
- **Rate Limit**: 10 writes/minute per admin

### Sense onboarding (REcontrol)

Onboarding (bootstrap, run-stage, import SAFMR, validate, publish) runs in **REcontrol**; no readvise internal APIs are used. Required env in REcontrol:

- **NEXT_PUBLIC_SUPABASE_URL**, **SUPABASE_SERVICE_ROLE_KEY** — Supabase (shared core + readvise schema).
- **CENSUS_API_KEY** — Census API key (tracts, ACS).
- **HUD_API_KEY** — HUD USPS API key (ZIP–tract crosswalk).
- **SENSE_ADMIN_WORKSPACE_ID** — Optional; not required for bootstrap. Snapshots are **market-level** (one row per market/tract/month). Bootstrap includes the snapshot step; REcontrol (super admin) runs monthly snapshot updates for all enabled markets. Workspace users do **not** run snapshots.

Optional:

- **ZILLOW_CSV_DIR** — Directory for Zillow CSV files (default `remarket_imports` under cwd). If Zillow CSVs are not present, the Zillow stage is skipped or fails with "CSV not found".
- **READVISE_SAFMR_PATH** — Path to SAFMR XLSX for bootstrap/hud_safmr stage when not using the Import SAFMR modal.

**READVISE_INTERNAL_URL** is not required for onboarding; REcontrol no longer calls readvise for bootstrap, run-stage, import-safmr, or validate/publish.

### Monthly Sense snapshots

**Who runs snapshots**: REcontrol (super admin). **Workspace users do not run snapshots**; they consume market-level snapshot data that REcontrol updates.

**How to run monthly snapshots**:

1. **Cron (recommended)**  
   Call `POST /api/cron/sense-snapshots` with header `x-cron-secret: <CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`. Set **CRON_SECRET** in REcontrol env. The job runs `buildSenseSnapshots` + agg refresh for every **enabled** market in `core.sense_markets`. Schedule once per month (e.g. 1st of month).

2. **Manual (super admin)**  
   Use the "Run monthly snapshots" server action from the REcontrol UI (e.g. Sense → Markets or an operator button) so a super admin can trigger the same job on demand.

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

### 7. Onboarding a New Sense Market

**When**: Adding a new geography to the Sense space (e.g. a new city or metro)

**Overview**: Markets are defined in `core.sense_markets`. After inserting a row, you run the **bootstrap** pipeline in **REcontrol** to backfill tracts, crosswalk, ACS, Zillow, HUD SAFMR, snapshots, neighborhoods, then validate and publish. Bootstrap runs asynchronously in the REcontrol server process (no readvise API).

**Steps**:

1. **Insert the market row** (connect to production DB):

```sql
-- Replace market_key, name, cbsa_code with the new market.
-- market_key: stable slug, e.g. frankfort_ky (lowercase, underscores).
-- cbsa_code: Census CBSA code if applicable (e.g. 23180 for Frankfort, KY μSA); NULL allowed.

INSERT INTO core.sense_markets (id, market_key, name, cbsa_code, enabled)
VALUES (
  gen_random_uuid(),
  'frankfort_ky',           -- market_key
  'Frankfort, KY',          -- name
  '23180',                  -- CBSA code (Frankfort, KY micropolitan)
  true                      -- enabled
);
```

2. **Open the market in REcontrol**  
   - Go to **Dashboard → Sense Ops → Markets**  
   - Click the new market (e.g. "Frankfort, KY")

3. **Run Bootstrap**  
   - On the market detail page, click **"Bootstrap Market"**  
   - Bootstrap runs the full pipeline (tracts → crosswalk → ACS → Zillow → HUD SAFMR → snapshots → neighborhoods → validate) in the **REcontrol** server. It runs async; the page will refresh and you can check "Bootstrap Run Timeline" for status.

4. **Monitor the run**  
   - Refresh the market detail page and watch "Bootstrap Run Timeline" for completion or errors.  
   - If a step fails, use "Run stage" to re-run that stage only, or fix the underlying issue (e.g. data provider, credentials) and re-run Bootstrap. Check **REcontrol** server logs (where `npm run dev` or the Node process runs) for `[Sense bootstrap]` and stage errors.

5. **Publish when ready**  
   - After bootstrap completes successfully, run **"Publish"** to write availability so the market shows as available and workspaces can use it.

6. **Optional**  
   - Use the **Enable/Disable** toggle on the market to control whether it is selectable by workspaces.  
   - Use **Validate** to check readiness without publishing.

**Example: Frankfort, KY**

- **market_key**: `frankfort_ky`  
- **name**: `Frankfort, KY`  
- **cbsa_code**: `23180` (Frankfort, KY micropolitan statistical area)

Use the `INSERT` above with these values to onboard Frankfort KY, then follow steps 2–5 to bootstrap and publish.

---

### 8. Importing HUD SAFMR (upload)

**When**: Ingesting SAFMR XLSX for a market without relying on a server file path (works in production).

**Steps**:
1. Open the market: **Dashboard → Sense Ops → Markets → [market]**.
2. Click **"Import SAFMR"**.
3. In the modal: choose the **XLSX file**, optionally set **FY year** (e.g. 2026), then **Import & run**.
4. The file is processed in **REcontrol** (ingest runs in the server action). Any error is shown in the REcontrol modal.

**Body size limits**:
- Next.js Server Actions default to 1 MB. We set `experimental.serverActions.bodySizeLimit` to 20 MB in `next.config.ts`. Restart the REcontrol dev/server after changing it.

**Data coverage panel (Geometry / ACS / SAFMR show "No" after bootstrap)**:
- The panel reads from `core.sense_market_availability`, which is updated when the **Publish** step runs. The publish step calls `readvise.validate_market_readiness(_market_id)` and upserts the result.
- If bootstrap completed but the panel still shows No for some layers, run **Validate & Publish** again from the market page (Run Individual Stage → Validate & Publish). That re-runs the readiness check and updates the panel. If it still shows No after that, the readiness RPC may be evaluating different data (e.g. schema or table names in the DB).

---

### What the Data Coverage flags mean (can I trust them?)

The **Data Coverage** section shows “Per-layer availability **as of last publish**”. Each flag is set by the **Validate & Publish** step, which runs the DB function `readvise.validate_market_readiness(_market_id)` and writes the result into `sense_market_availability`. So the panel reflects the **last time you clicked Validate & Publish**, not live DB state.

| Flag | What the RPC actually checks | So you can believe… |
|------|------------------------------|----------------------|
| **Tracts loaded** | Active rows in `sense_market_tracts` for this market | Yes = tracts are loaded. |
| **Geometry** | ≥50% of market tracts have a row in `sense_geo_tracts` | Yes = geometry import (or RPC upsert) populated enough tracts. |
| **ACS 5-year projections** | ≥50% of market tracts have at least one row in **`sense_agg_tract_monthly`** | “Projections” here = **aggregated tract monthly** data (the layer used for tract indices), not raw ACS. **No** = that table has &lt;50% of this market’s tracts. Run **Snapshots** (and any refresh that fills `sense_agg_tract_monthly`) to get **Yes**. |
| **HPI (Zillow)** | At least one ZHVI row exists for a ZIP that maps to this market’s tracts (via crosswalk) | Yes = Zillow ingest + crosswalk cover at least one ZIP. |
| **Neighborhoods** | At least one row in `sense_neighborhood_tract_weights` for a tract in this market | Yes = neighborhood weights exist for this market (workspace-scoped). |
| **HUD SAFMR** | At least one row in **`sense_safmr_tract_projection`** for a tract in this market | Yes = SAFMR ingest (e.g. **Import SAFMR** modal then **Validate & Publish**) wrote tract projections. So if you used the modal, got 200, and then ran **Validate & Publish**, **HUD SAFMR: Yes** is correct. |

**Bottom line**: You can trust the panel for the state at last publish. **HUD SAFMR: Yes** after using the Import SAFMR modal and then Validate & Publish is correct. **ACS 5-year projections: No** means the aggregated tract monthly layer isn’t filled enough for this market; run the **Snapshots** stage (with a workspace ID) so that the pipeline that populates `sense_agg_tract_monthly` runs.

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

### Bootstrap Says Failed (no server/console error)

**Symptom**: Clicking "Bootstrap Market" shows failed; no clear error in UI or console.

**What we did**:
- Bootstrap error is now always shown in the red box under the buttons (with a fallback message if the server returns nothing).
- Server-side: REcontrol logs `[Sense bootstrap]` with the error and `marketKey` to the **Next.js server** stdout (where you run `npm run dev` or your process manager). Check those logs for the real cause.

**Common causes**:
- **SUPABASE_SERVICE_ROLE_KEY** not set — bootstrap runs in REcontrol and uses the admin client.
- **CENSUS_API_KEY** or **HUD_API_KEY** missing — required for tracts and crosswalk stages.
- Market not found, or a stage threw (e.g. Census/HUD rate limit). The error is logged and shown in the UI.

**Next step**: Reproduce the click, then check the terminal/logs for the process running REcontrol (Next.js). Look for `[Sense bootstrap]` and the message that follows.

---

### Bootstrap Skipped (Already Completed This Month)

**Symptom**: In REcontrol server logs you see `[Bootstrap] Skipped (already completed this month) for marketKey=...`. The pipeline (including geometry) does not run.

**Cause**: Bootstrap is idempotent per calendar month; if a run already completed this month, the orchestrator skips to avoid duplicate work.

**Options**:
1. **Force re-run**: On the market page, check **Force re-run** next to the Bootstrap Market button, then click **Bootstrap Market**. This runs the full pipeline again (including geometry) and ignores the monthly skip.
2. **Run geometry only**: Use **Run Individual Stage** → select **Geometry** → Run. This imports tract geometries without re-running the rest of the pipeline.

---

### SAFMR Step Skipped / Failing

**Symptom**: Bootstrap shows HUD SAFMR as **skipped** (amber **−** in the timeline), or SAFMR step fails.

**Cause**: During bootstrap, SAFMR only runs when a file path is available: `READVISE_SAFMR_PATH` (in REcontrol env) or `safmrXlsxPath` in options. If neither is set, the step is marked **skipped** (not failed).

**Options**:
1. **Import SAFMR from REcontrol**: Use **Import SAFMR** on the market page to upload the HUD XLSX. REcontrol runs the ingest locally; no server file path needed. After uploading, run **Validate & Publish** to refresh the Data Coverage panel (`has_safmr`).
2. **Server path**: Set `READVISE_SAFMR_PATH` in REcontrol env to the XLSX path and re-run bootstrap (or run the **HUD SAFMR** stage).

---

### Snapshots: Workspace Market Mismatch

**Symptom**: When running the **Snapshots** stage, REcontrol server logs: `market_key X does not match sense_settings.market_id Y`, or snapshots appear to fail.

**Cause**: The workspace’s **Sense** settings (`sense_settings.market_id`) were set to a different market than the one you’re building snapshots for.

**Fix**: The snapshot builder now **aligns** the workspace to the requested market: when it detects a mismatch, it updates `sense_settings.market_id` for that workspace to the market you’re building for, then continues. No manual change needed. If you see the log, the run should still complete.

---

### Workspace shows "Sense isn't available here yet" / Request this market

**Symptom**: In readvise (RE:advise), the Sense tab shows "Sense isn't available here yet" and "Request this market". User clicks **Request this market** but nothing visible happens, or the workspace still has no market.

**What "Request this market" does**: It calls `POST /api/operate/sense/request-market`, which records the request in **core.market_requests**. It **does not** assign the market to the workspace or change Sense availability.

**What you need to do**: (1) The UI now shows "Request recorded" and a note that an admin can enable the market in REcontrol. (2) A super admin must open **REcontrol → Sense → Markets**, ensure the market is **Enabled**, and that the workspace has that market set for Sense (e.g. sense_settings or product-specific assignment).

---

### Snapshots ran but ACS 5-year projections still No

**Symptom**: You ran **Snapshots** from REcontrol; server logs show `[run-stage] snapshots completed`, but Data Coverage still shows **ACS 5-year projections: No**.

**Cause**: The flag is based on **sense_agg_tract_monthly**. The Snapshots stage used to only write **sense_input_snapshots** and did not refresh the agg table.

**Fix**: The Snapshots stage now **also** runs **sense_refresh_agg_tract_monthly** after building snapshots. Run **Validate & Publish** after Snapshots to refresh Data Coverage; the ACS projections flag should then turn Yes (if Zillow + crosswalk data exist).

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

### Insert a New Sense Market (then bootstrap via UI)

```sql
INSERT INTO core.sense_markets (id, market_key, name, cbsa_code, enabled)
VALUES (gen_random_uuid(), 'market_key_slug', 'Display Name', 'CBSA_CODE_OR_NULL', true);
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
