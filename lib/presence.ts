/**
 * Presence tracking for REcontrol
 *
 * NOTE: REcontrol is a super-admin tool that operates across all workspaces,
 * not within a specific workspace context. For this reason, we don't track
 * REcontrol presence in the workspace_presence table (which requires a workspace_id).
 *
 * Super admin activity is tracked via admin_audit_log for operations performed,
 * and last_login_at from auth.users for login activity.
 *
 * This file exists as a placeholder for consistency with other apps.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface UpdatePresenceOptions {
  workspaceId: string;  // For workspace-scoped apps like readvise/rebuild/redeal
  userId: string;
  supabase: SupabaseClient;
  route?: string;
}

/**
 * REcontrol does not track workspace presence (super admins are workspace-agnostic)
 * This function is a no-op for REcontrol
 */
export async function updateWorkspacePresence(
  _options: UpdatePresenceOptions
): Promise<void> {
  // No-op for REcontrol
  // Super admin activity is tracked via audit log, not workspace presence
  return;
}
