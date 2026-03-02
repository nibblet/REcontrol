# Sense Market Bootstrap & Onboarding — Implementation Plan

**Goal:** Onboard a new market (e.g. Frankfort, cbsa:23180) from REcontrol and make it available to the appropriate workspaces in readvise. Fix silent failures (e.g. snapshots with no error in logs or UI), add debugging and error surfacing, then validate the flow until Frankfort is successfully onboarded and the process is repeatable.

---

## 1. Current Flow (As-Is)

**Update:** Sense onboarding (bootstrap, run-stage, import SAFMR, validate, publish) now **runs in REcontrol**. The pipeline code lives in `recontrol/lib/sense/`. REcontrol no longer calls readvise internal APIs for these operations. Readvise endpoints `POST /api/internal/sense/bootstrap`, `run-stage`, `import-safmr`, and `validate` are **deprecated** (410) and should not be used.

### 1.1 REcontrol (local execution)

| Action | REcontrol | Notes |
|--------|-----------|--------|
| **Bootstrap Market** | `triggerBootstrap(marketKey, { force })` → `runMarketBootstrap(...)` in background | Pipeline runs async in REcontrol server. Progress in `core.sense_ingest_runs_market_bootstrap`. |
| **Run Individual Stage** | `runStage(marketKey, stage, options)` → `runStageLocal(...)` | Async stages run in background; validate/publish are synchronous and return result. |
| **Validate & Publish** | `validateMarket(marketKey)` / `publishMarket(...)` | Call `readvise.validate_market_readiness` and upsert `core.sense_market_availability` via admin client. |
| **Import SAFMR** | `importSafmr(formData)` → `ingestSafmrFromBuffer(...)` | File buffer is passed to local SAFMR ingest; no readvise API. |

### 1.2 Bootstrap pipeline (REcontrol)

When **Bootstrap** is triggered in REcontrol, `runMarketBootstrap(workspaceId, marketKey, { force })` runs in the REcontrol process with:

- **workspaceId** = `SENSE_ADMIN_WORKSPACE_ID` or `00000000-0000-0000-0000-000000000000`
- **options** = `{ force }` only — **runSnapshots** and **runNeighborhoods** are never true in the default bootstrap call

**Steps run (in order):**

1. Validate (env keys)
2. Tracts (build market tracts)
3. Geometry (import tract geometries)
4. Crosswalk (ZIP–tract crosswalk)
5. ACS (ACS 5-year ingest)
6. Zillow (Zillow CSV ingest)
7. **SAFMR** — only if `READVISE_SAFMR_PATH` or options.safmrXlsxPath is set; else step marked **skipped**
8. **Snapshots** — only if `options.runSnapshots === true` → **never true from REcontrol**
9. **Neighborhoods** — only if `options.runNeighborhoods === true` → **never true from REcontrol**
10. Publish (validate_market_readiness + upsert sense_market_availability)

So the **Bootstrap Run Timeline** in REcontrol shows snapshots/neighborhoods as “not completed” because those steps are **never run** in the bootstrap call from REcontrol.

### 1.3 Run-stage Snapshots (when user runs “Snapshots” manually)

1. User selects stage **Snapshots**, enters **Workspace ID**, clicks Run.
2. REcontrol calls `runStageLocal(marketKey, 'snapshots', { workspaceId })`.
3. REcontrol returns **202-style** (async: true) immediately, then in the background:
   - `runSnapshots(workspaceId, marketKey)` →
     - `buildSenseSnapshots({ workspaceId, marketKey, asOfMonth })` → writes **sense_input_snapshots**
     - `refreshAggTractMonthly(marketKey)` → calls **sense_refresh_agg_tract_monthly** (and market agg)
4. On **success**: `console.log('[run-stage] snapshots completed for ...')` — no record in DB for the UI.
5. On **failure**: `console.error('[run-stage] snapshots failed for ...', err)` — **no error persisted or returned to UI**; user only sees “Started — runs async. Check the timeline below,” and the timeline is the **bootstrap** timeline, which does not include this run-stage run.

So snapshots can “fail” (or produce no aggregation) with **no error in server logs** if:

- `buildSenseSnapshots` returns without throwing but with 0 rows written (e.g. no tracts, or no data in sense_agg_tract_monthly for the builder to read).
- `refreshAggTractMonthly` fails with only `console.warn` (no throw).

Or with **no error in UI** because:

- Async stages never return the error to the client; there is no “run-stage result” table or toast for background failure.

### 1.4 Data flow for “ACS 5-year projections” and aggregation

- **Data Coverage “ACS 5-year projections”** = `validate_market_readiness` checks **sense_agg_tract_monthly**: ≥50% of market tracts must have at least one row.
- **sense_agg_tract_monthly** is populated only by the RPC **sense_refresh_agg_tract_monthly** (Zillow + crosswalk → tract-level indices). It is **not** populated by `buildSenseSnapshots`.
- **buildSenseSnapshots** reads from **sense_agg_tract_monthly** (and other sources) and writes **sense_input_snapshots**. So for a **new** market, the first time you run snapshots, `loadAggSeries` may read an empty or partial **sense_agg_tract_monthly**; we now also run `refreshAggTractMonthly` after buildSenseSnapshots so the agg table is filled. Order in run-stage is: (1) buildSenseSnapshots, (2) refreshAggTractMonthly.

### 1.5 Workspace / “Request this market”

- **Request this market** in readvise writes to **core.market_requests**. It does **not** set the workspace’s Sense market or enable the market for that workspace.
- A super admin must **enable** the market in REcontrol (Sense → Markets) and **assign** the market to the workspace (e.g. sense_settings.market_id or product-specific assignment). There is no single “assign market to workspace” button in the current flow; assignment may be implicit (e.g. first requested market) or require a separate step.

---

## 2. Root Causes (Why Snapshots “Fail” With No Error)

1. **Bootstrap from REcontrol never runs snapshots** — **Resolved**: bootstrap now runs snapshots by default (market-level; no workspace required). REcontrol also provides a monthly snapshot job for all enabled markets.
2. **Run-stage async stages do not persist result or error** — so when the user runs “Snapshots” and it fails (or writes 0 rows), the UI has nothing to show.
3. **No structured logging** — buildSenseSnapshots returns a summary (processed, succeeded, failed, missingPricing, etc.) but run-stage does not log it; refreshAggTractMonthly on failure only warns.
4. **Aggregation can fail silently** — refreshAggTractMonthly uses console.warn and does not throw, so “ACS 5-year projections” can stay No with no visible error.

---

## 3. Implementation Plan

### Phase A — Visibility & debugging (do first)

| # | Task | Owner | Details |
|---|------|--------|---------|
| A1 | **Log snapshot summary in run-stage** | Dev | After `buildSenseSnapshots` in run-stage, log the returned summary (e.g. `[run-stage] snapshots summary: processed, succeeded, failed, missingPricing, ...`) so server logs show whether any rows were written. |
| A2 | **Log and surface aggregation refresh result** | Dev | In run-stage, after `refreshAggTractMonthly`, either (a) have it return rowsAffected or error, or (b) call an RPC that returns count and log it. Log clearly when agg refresh fails or writes 0 rows. |
| A3 | **Structured run-stage logging** | Dev | At start of each async stage: log `[run-stage] stage=snapshots marketKey=... workspaceId=...`. On completion: log summary or error. On throw: log stack. Consider a simple `run_stage_log` table (stage, market_key, workspace_id, status, message, created_at) for async runs so the UI can show “last run-stage result” per stage. |
| A4 | **Surface async stage errors in UI** | Dev | Option A: Persist last run-stage error (e.g. in a small table or in sense_ingest_runs_*) and show it on the market page (e.g. “Last Snapshots run: failed — &lt;message&gt;”). Option B: At least show in the “Run Individual Stage” area: “Stage runs in background. Check readvise server logs for errors.” and document in runbook. Prefer Option A so operators see failure without SSH. |

### Phase B — Bootstrap and snapshots behavior

| # | Task | Owner | Details |
|---|------|--------|---------|
| B1 | **Decide bootstrap vs run-stage for snapshots** | Product/Dev | (1) Should “Bootstrap Market” from REcontrol include snapshots (and optionally neighborhoods)? If yes, we need to pass a **workspaceId** (and runSnapshots: true) from REcontrol to bootstrap. (2) Where does that workspaceId come from? (e.g. “default workspace for new markets,” or a dropdown in REcontrol.) Document decision. |
| B2 | **Add optional runSnapshots/runNeighborhoods to bootstrap API** | Dev | Readvise `POST /api/internal/sense/bootstrap` accepts body `{ marketKey, force, runSnapshots?, runNeighborhoods?, workspaceId? }`. If runSnapshots is true, workspaceId is required; orchestrator runs snapshots (and optionally neighborhoods) with that workspace. |
| B3 | **REcontrol: Bootstrap UI for snapshots** | Dev | If B1 says bootstrap should run snapshots: add checkbox “Run snapshots after pipeline” and workspace ID input (or selector). When checked, call bootstrap with runSnapshots: true and workspaceId. |
| B4 | **Or: Keep snapshots manual but improve feedback** | Dev | If B1 says keep snapshots as a separate step: ensure run-stage snapshots (a) log summary, (b) persist failure/success so the market page can show “Last Snapshots: succeeded (N rows) / failed (message).” |

### Phase C — Run-stage result persistence (recommended)

| # | Task | Owner | Details |
|---|------|--------|---------|
| C1 | **Table or store for last run-stage result** | Dev | e.g. `core.sense_run_stage_log` (market_id, stage, workspace_id nullable, status: 'running'|'completed'|'failed', message nullable, summary jsonb nullable, started_at, finished_at). On async stage start: insert running. On completion: update completed + summary. On catch: update failed + message. |
| C2 | **Readvise run-stage handler writes to log** | Dev | Before firing background run(), insert a row with status=running. In the background run() on success: update row with status=completed and summary (e.g. from buildSenseSnapshots return). On catch: update status=failed, message=err.message. |
| C3 | **REcontrol market page shows last run per stage** | Dev | When loading market detail, fetch last run_stage_log rows for this market (or from a small API that returns last run per stage). Display under “Run Individual Stage”: e.g. “Last Snapshots: completed (123 rows) at 2/27/2026 4:00 PM” or “Last Snapshots: failed — No active neighborhood layer” so operators see outcome without checking server logs. |

### Phase D — Frankfort onboarding (validation)

| # | Task | Owner | Details |
|---|------|--------|---------|
| D1 | **Pre-conditions checklist** | Ops | Market exists in REcontrol (Sense → Markets) for Frankfort (cbsa:23180). Crosswalk and Zillow data available for that CBSA. At least one workspace to assign. |
| D2 | **Run bootstrap (force)** | Ops | REcontrol → Frankfort market → Force re-run checked → Bootstrap Market. Confirm in readvise logs: validate → tracts → geometry → crosswalk → ACS → Zillow (and SAFMR skipped or completed). |
| D3 | **Run Snapshots with workspaceId** | Ops | Run Individual Stage → Snapshots, enter a valid workspace ID → Run. Check readvise logs for “[run-stage] snapshots summary: …” and any “[run-stage] sense_refresh_agg_tract_monthly …” message. |
| D4 | **Run Validate & Publish** | Ops | Run stage Validate & Publish. Confirm Data Coverage shows ACS 5-year projections Yes (and other flags as expected). |
| D5 | **Assign market to workspace** | Ops | Ensure the workspace used for snapshots has sense_settings.market_id set to Frankfort’s market id (or use product flow to “assign market”). Open readvise Sense for that workspace and confirm Frankfort is available. |
| D6 | **Document any manual steps** | Ops | If any step required manual DB or config change, add it to OPERATOR_RUNBOOK.md so the next market is repeatable. |

### Phase E — Playbook for next market

| # | Task | Owner | Details |
|---|------|--------|---------|
| E1 | **One-page “Onboard a new Sense market”** | Dev/Ops | In OPERATOR_RUNBOOK.md (or linked doc): (1) Add market in REcontrol if not present. (2) Bootstrap (with force if already run this month). (3) Import SAFMR if needed (modal). (4) Run Snapshots with workspace ID. (5) Validate & Publish. (6) Assign market to workspace(s). (7) Verify in readvise Sense. Include “if something fails” pointers to server logs and the new run-stage log/UI. |
| E2 | **Runbook: “Snapshots / aggregation still No”** | Dev | Already partially done; add: “Check readvise logs for [run-stage] snapshots summary and refresh_agg. If succeeded=0, check sense_agg_tract_monthly and Zillow/crosswalk for that market.” |

---

## 4. Suggested Order of Work

1. **Phase A** (A1–A4) — Add logging and, if possible, a minimal “last run-stage result” so Frankfort runs show success/failure and row counts.
2. **Phase D** (D1–D6) — Run Frankfort bootstrap + snapshots + publish + assign; note every failure and fix (or document).
3. **Phase C** (C1–C3) — Implement run-stage result persistence and REcontrol display so future runs are visible in the UI.
4. **Phase B** (B1–B4) — Decide and implement whether bootstrap should run snapshots and with which workspace.
5. **Phase E** (E1–E2) — Finalize playbook and runbook so the next market is a smooth repeat of the Frankfort flow.

---

## 5. Success Criteria

- **Frankfort (cbsa:23180)** is fully onboarded: Data Coverage shows Yes for tracts, geometry, ACS projections, HPI, and SAFMR (and neighborhoods if applicable); at least one workspace can use Sense for Frankfort.
- **Errors are visible**: Snapshots (and aggregation) failures appear in readvise server logs with clear messages and, after Phase C, in the REcontrol market page.
- **Playbook**: A new market can be onboarded by following the runbook without tribal knowledge.

---

## 6. References

- REcontrol: `OPERATOR_RUNBOOK.md`, `lib/actions/sense.ts`, `lib/sense/` (orchestrator, run-stage, ingest modules), `app/(dashboard)/sense/markets/[marketId]/MarketActions.tsx`
- Readvise: Internal sense APIs are deprecated (410). Pipeline logic is in REcontrol; readvise keeps `lib/sense/` for reference or non-onboarding use (e.g. Sense UI, request-market).
- Data Coverage: `validate_market_readiness` (readvise), `sense_agg_tract_monthly`, `sense_input_snapshots`
