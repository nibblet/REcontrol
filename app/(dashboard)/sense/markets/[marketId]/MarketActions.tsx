'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  triggerBootstrap,
  runStage,
  validateMarket,
  publishMarket,
  toggleMarketEnabled,
  type SenseStage,
  type RunStageOptions,
} from '@/lib/actions/sense'

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

type StageOption = {
  id: SenseStage
  label: string
  description: string
  async: boolean
  needsWorkspaceId?: boolean
}

const STAGES: StageOption[] = [
  { id: 'tracts',        label: 'Tracts',           description: 'Fetch tract IDs for CBSA from Census API',         async: true  },
  { id: 'crosswalk',     label: 'Crosswalk',         description: 'Refresh ZIP→tract crosswalk from HUD USPS',        async: true  },
  { id: 'acs',           label: 'ACS',               description: 'Ingest ACS 5-year data for all market tracts',     async: true  },
  { id: 'zillow',        label: 'FHFA / Zillow',     description: 'Ingest Zillow HPI CSV files (must be on server)',  async: true  },
  { id: 'hud_safmr',    label: 'HUD SAFMR',         description: 'Ingest SAFMR XLSX (must be on server)',            async: true  },
  { id: 'snapshots',     label: 'Snapshots',         description: 'Build tract snapshots — requires workspace ID',    async: true,  needsWorkspaceId: true },
  { id: 'neighborhoods', label: 'Neighborhoods',     description: 'Refresh neighborhood weights — requires workspace ID', async: true, needsWorkspaceId: true },
  { id: 'validate',      label: 'Validate',          description: 'Run readiness checks and show pass/fail',          async: false },
  { id: 'publish',       label: 'Validate & Publish','description': 'Validate then write availability record',        async: false },
]

// ---------------------------------------------------------------------------
// Types / helpers
// ---------------------------------------------------------------------------

type ActionState = 'idle' | 'loading' | 'ok' | 'error'

function useAction() {
  const [state, setState] = useState<ActionState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  function start() { setState('loading'); setMessage(null); setResult(null) }
  function succeed(msg?: string, res?: Record<string, unknown>) {
    setState('ok'); setMessage(msg ?? null); setResult(res ?? null)
  }
  function fail(msg: string) { setState('error'); setMessage(msg) }
  function reset() { setState('idle'); setMessage(null); setResult(null) }

  return { state, message, result, start, succeed, fail, reset }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  marketId: string
  marketKey: string
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MarketActions({ marketId, marketKey, enabled: initialEnabled }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Per-action state
  const bootstrap = useAction()
  const stageRunner = useAction()
  const enableToggle = useAction()

  // UI state
  const [isEnabled, setIsEnabled] = useState(initialEnabled)
  const [selectedStage, setSelectedStage] = useState<SenseStage | ''>('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [validateResult, setValidateResult] = useState<Record<string, unknown> | null>(null)

  const selectedStageDef = STAGES.find((s) => s.id === selectedStage)
  const needsWs = selectedStageDef?.needsWorkspaceId ?? false

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function refreshPage() {
    startTransition(() => router.refresh())
  }

  async function handleBootstrap() {
    bootstrap.start()
    const result = await triggerBootstrap(marketKey)
    if (result.ok) {
      bootstrap.succeed('Bootstrap started — runs async in readvise')
      setTimeout(() => { bootstrap.reset(); refreshPage() }, 3000)
    } else {
      bootstrap.fail(result.error)
    }
  }

  async function handleRunStage() {
    if (!selectedStage) return
    stageRunner.start()
    setValidateResult(null)

    const options: RunStageOptions = {}
    if (needsWs && workspaceId.trim()) {
      options.workspaceId = workspaceId.trim()
    }

    const result = await runStage(marketKey, selectedStage, options)

    if (!result.ok) {
      stageRunner.fail(result.error)
      return
    }

    if ('async' in result && result.async) {
      stageRunner.succeed('Started — runs async. Check the timeline below.')
      setTimeout(() => { stageRunner.reset(); refreshPage() }, 3000)
    } else if ('result' in result) {
      // Sync result (validate, publish)
      stageRunner.succeed('Completed')
      setValidateResult(result.result as Record<string, unknown>)
      setTimeout(refreshPage, 500)
    }
  }

  async function handleToggleEnabled() {
    const newVal = !isEnabled
    setIsEnabled(newVal)
    enableToggle.start()
    const result = await toggleMarketEnabled(marketId, newVal)
    if (result.ok) {
      enableToggle.succeed()
      refreshPage()
    } else {
      setIsEnabled(!newVal) // revert
      enableToggle.fail(result.error)
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isAnyLoading =
    bootstrap.state === 'loading' ||
    stageRunner.state === 'loading' ||
    enableToggle.state === 'loading'

  return (
    <div className="space-y-5">
      {/* Row 1: primary actions + enable toggle */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Bootstrap */}
        <Button
          onClick={handleBootstrap}
          disabled={isAnyLoading || bootstrap.state === 'ok'}
          className="min-w-[160px]"
        >
          {bootstrap.state === 'loading'
            ? 'Triggering…'
            : bootstrap.state === 'ok'
            ? '✓ Started'
            : 'Bootstrap Market'}
        </Button>

        {/* Enable/Disable toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggleEnabled}
            disabled={isAnyLoading}
          />
          <span className="text-sm font-medium">
            {isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>

      {/* Row 2: Stage runner */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Run Individual Stage</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px] max-w-xs">
            <select
              value={selectedStage}
              onChange={(e) => {
                setSelectedStage(e.target.value as SenseStage | '')
                stageRunner.reset()
                setValidateResult(null)
              }}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select stage…</option>
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {needsWs && (
            <div className="flex-1 min-w-[200px] max-w-xs">
              <input
                type="text"
                placeholder="Workspace UUID (required)"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              />
            </div>
          )}

          <Button
            variant="outline"
            onClick={handleRunStage}
            disabled={!selectedStage || isAnyLoading || stageRunner.state === 'ok' || (needsWs && !workspaceId.trim())}
          >
            {stageRunner.state === 'loading'
              ? 'Running…'
              : stageRunner.state === 'ok'
              ? '✓ Done'
              : 'Run Stage'}
          </Button>
        </div>

        {selectedStageDef && (
          <p className="text-xs text-muted-foreground">{selectedStageDef.description}</p>
        )}
      </div>

      {/* Error messages */}
      {bootstrap.state === 'error' && bootstrap.message && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
          Bootstrap: {bootstrap.message}
        </p>
      )}
      {stageRunner.state === 'error' && stageRunner.message && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
          Stage error: {stageRunner.message}
        </p>
      )}
      {enableToggle.state === 'error' && enableToggle.message && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
          Toggle error: {enableToggle.message}
        </p>
      )}

      {/* Sync stage results (validate / publish) */}
      {(stageRunner.state === 'ok' && validateResult) && (
        <details open className="text-sm">
          <summary className="cursor-pointer font-medium mb-2">Result</summary>
          <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-80">
            {JSON.stringify(validateResult, null, 2)}
          </pre>
        </details>
      )}

      {/* Success message for async stages */}
      {stageRunner.state === 'ok' && !validateResult && stageRunner.message && (
        <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">
          {stageRunner.message}
        </p>
      )}
      {bootstrap.state === 'ok' && bootstrap.message && (
        <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">
          {bootstrap.message}
        </p>
      )}
    </div>
  )
}
