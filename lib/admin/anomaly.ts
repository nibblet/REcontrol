/**
 * Anomaly detection logic for REcontrol dashboard
 */

export interface Anomaly {
  type: 'usage_spike' | 'sense_failure' | 'workspace_inactive'
  severity: 'warning' | 'critical'
  message: string
  workspaceId?: string
  workspaceName?: string
  metric?: string
  value?: number
}

/**
 * Detect anomalies in workspace usage
 */
export function detectUsageAnomalies(
  workspaces: Array<{
    workspace_id: string
    workspace_name: string
    current_tokens: number
    avg_tokens_7d?: number
  }>
): Anomaly[] {
  const anomalies: Anomaly[] = []

  for (const workspace of workspaces) {
    // Skip if no historical data
    if (!workspace.avg_tokens_7d || workspace.avg_tokens_7d === 0) continue

    // Check for token spike (current > 2x 7-day average)
    const spikeRatio = workspace.current_tokens / workspace.avg_tokens_7d
    if (spikeRatio > 2) {
      anomalies.push({
        type: 'usage_spike',
        severity: spikeRatio > 3 ? 'critical' : 'warning',
        message: `Token spike +${Math.round((spikeRatio - 1) * 100)}% vs 7d avg`,
        workspaceId: workspace.workspace_id,
        workspaceName: workspace.workspace_name,
        metric: 'tokens',
        value: workspace.current_tokens,
      })
    }
  }

  return anomalies
}

/**
 * Detect sense operation failures
 */
export function detectSenseAnomalies(
  markets: Array<{
    market_id: string
    market_name: string
    success_rate_24h: number
  }>
): Anomaly[] {
  const anomalies: Anomaly[] = []

  for (const market of markets) {
    // Check for high failure rate (< 85% success)
    if (market.success_rate_24h < 85) {
      anomalies.push({
        type: 'sense_failure',
        severity: market.success_rate_24h < 50 ? 'critical' : 'warning',
        message: `${market.market_name} - Job failure rate ${(
          100 - market.success_rate_24h
        ).toFixed(1)}% (last 24h)`,
        metric: 'success_rate',
        value: market.success_rate_24h,
      })
    }
  }

  return anomalies
}
