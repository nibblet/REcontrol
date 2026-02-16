/**
 * Admin audit log client functions for REcontrol
 */

import { createClient } from '@/lib/supabase/server'

export interface AuditLogEntry {
  id: string
  actor_user_id: string
  actor_email: string | null
  workspace_id: string | null
  workspace_name: string | null
  action: string
  resource_type: string
  resource_id: string | null
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  reason: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

/**
 * Get audit log entries with optional filters
 */
export async function adminGetAuditLog(
  workspaceId?: string,
  action?: string,
  limit: number = 50,
  offset: number = 0
): Promise<AuditLogEntry[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema('core')
    .rpc('admin_get_audit_log', {
      p_workspace_id: workspaceId || null,
      p_action: action || null,
      p_limit: limit,
      p_offset: offset,
    })

  if (error) {
    console.error('Error getting audit log:', error)
    throw error
  }

  return data || []
}
