/**
 * Admin RPC client wrappers for REcontrol
 * All functions require super_admin role (enforced server-side)
 */

import { createClient } from '@/lib/supabase/server'

export interface Workspace {
  workspace_id: string
  workspace_name: string
  owner_email: string
  created_at: string
  member_count: number
  tier_readvise: string
  tier_rebuild: string
  tier_redeal: string
}

export interface WorkspaceDetail {
  workspace: {
    id: string
    name: string
    owner_user_id: string
    owner_email: string
    created_at: string
  }
  members: Array<{
    user_id: string
    email: string
    role: string
    joined_at: string
  }>
  entitlements: {
    [app: string]: {
      enabled: boolean
      tier: string
      features: Record<string, unknown>
      limits: Record<string, number>
    }
  }
}

export interface UsageSummary {
  workspace_id: string
  month_start: string
  usage: {
    [event_type: string]: {
      usage: number
      limit_readvise: number
      limit_rebuild: number
      limit_redeal: number
    }
  }
}

export interface TopUsage {
  workspace_id: string
  workspace_name: string
  total_quantity: number
}

export interface SenseMarket {
  market_id: string
  market_code: string
  market_name: string
  enabled: boolean
  last_run_at: string | null
  success_rate_24h: number
  recent_runs: Array<{
    id: string
    status: string
    total_tasks: number
    successful_tasks: number
    failed_tasks: number
    started_at: string
    completed_at: string | null
    error_summary: string | null
  }>
}

/**
 * List all workspaces with summary data
 */
export async function adminListWorkspaces(
  search?: string,
  limit: number = 50,
  offset: number = 0
): Promise<Workspace[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema('core')
    .rpc('admin_list_workspaces', {
      p_search: search || null,
      p_limit: limit,
      p_offset: offset,
    })

  if (error) {
    console.error('Error listing workspaces:', error)
    throw error
  }

  return data || []
}

/**
 * Get full workspace detail including members and entitlements
 */
export async function adminGetWorkspaceDetail(
  workspaceId: string
): Promise<WorkspaceDetail> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema('core')
    .rpc('admin_get_workspace_detail', {
      p_workspace_id: workspaceId,
    })

  if (error) {
    console.error('Error getting workspace detail:', error)
    throw error
  }

  return data
}

/**
 * Get MTD usage summary for a workspace
 */
export async function adminGetUsageSummary(
  workspaceId: string,
  monthStart?: string
): Promise<UsageSummary> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema('core')
    .rpc('admin_get_usage_summary', {
      p_workspace_id: workspaceId,
      p_month_start: monthStart || null,
    })

  if (error) {
    console.error('Error getting usage summary:', error)
    throw error
  }

  return data
}

/**
 * Get top workspaces by usage for a specific event type
 */
export async function adminListTopUsage(
  eventType: 'advisor_tokens' | 'property_fresh_pull' | 'sense_run',
  monthStart?: string,
  limit: number = 10
): Promise<TopUsage[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema('core')
    .rpc('admin_list_top_usage', {
      p_event_type: eventType,
      p_month_start: monthStart || null,
      p_limit: limit,
    })

  if (error) {
    console.error('Error getting top usage:', error)
    throw error
  }

  return data || []
}

/**
 * Get sense operations summary across all markets
 */
export async function adminGetSenseOpsSummary(): Promise<SenseMarket[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema('core')
    .rpc('admin_get_sense_ops_summary')

  if (error) {
    console.error('Error getting sense ops summary:', error)
    throw error
  }

  return data || []
}

/**
 * Get MTD totals across all workspaces for dashboard
 */
export async function adminGetMTDTotals(): Promise<{
  advisor_tokens: number
  property_fresh_pull: number
  sense_run: number
}> {
  const supabase = await createClient()

  // Query usage_monthly_rollups for current month
  const currentMonth = new Date().toISOString().slice(0, 7) + '-01'

  const { data, error } = await supabase
    .schema('core')
    .from('usage_monthly_rollups')
    .select('event_type, total_quantity')
    .eq('month_start', currentMonth)

  if (error) {
    console.error('Error getting MTD totals:', error)
    return {
      advisor_tokens: 0,
      property_fresh_pull: 0,
      sense_run: 0,
    }
  }

  const totals = {
    advisor_tokens: 0,
    property_fresh_pull: 0,
    sense_run: 0,
  }

  data?.forEach((row) => {
    if (row.event_type === 'advisor_tokens') {
      totals.advisor_tokens += row.total_quantity
    } else if (row.event_type === 'property_fresh_pull') {
      totals.property_fresh_pull += row.total_quantity
    } else if (row.event_type === 'sense_run') {
      totals.sense_run += row.total_quantity
    }
  })

  return totals
}

/**
 * Workspace activity data (presence tracking)
 */
export interface WorkspaceActivity {
  workspace_id: string
  workspace_name: string
  created_at: string
  // Overall activity
  last_active_at_overall: string | null
  active_users_now_overall: number
  // Per-app last active
  last_active_at_readvise: string | null
  last_active_at_rebuild: string | null
  last_active_at_redeal: string | null
  last_active_at_recontrol: string | null
  // Per-app active now counts
  active_users_now_readvise: number
  active_users_now_rebuild: number
  active_users_now_redeal: number
  active_users_now_recontrol: number
}

/**
 * Workspace member activity data
 */
export interface WorkspaceMemberActivity {
  user_id: string
  primary_email: string
  display_name: string | null
  platform_role: string
  workspace_role: string
  last_login_at: string | null
  // Overall last seen
  last_seen_at_overall: string | null
  // Per-app last seen
  last_seen_at_readvise: string | null
  last_seen_at_rebuild: string | null
  last_seen_at_redeal: string | null
  last_seen_at_recontrol: string | null
  // Active now flag
  active_now: boolean
}

/**
 * List all workspaces with activity metrics
 */
export async function adminListWorkspacesActivity(
  search?: string,
  limit: number = 50,
  offset: number = 0
): Promise<WorkspaceActivity[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema('core')
    .rpc('admin_list_workspaces_activity', {
      p_search: search || null,
      p_limit: limit,
      p_offset: offset,
    })

  if (error) {
    console.error('Error listing workspaces activity:', error)
    throw error
  }

  return data || []
}

/**
 * List workspace members with per-app activity
 */
export async function adminListWorkspaceMembersActivity(
  workspaceId: string
): Promise<WorkspaceMemberActivity[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema('core')
    .rpc('admin_list_workspace_members_activity', {
      p_workspace_id: workspaceId,
    })

  if (error) {
    console.error('Error listing workspace members activity:', error)
    throw error
  }

  return data || []
}
