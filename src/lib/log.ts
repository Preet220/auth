import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export async function logActivity(
  user: User | null,
  profileName: string,
  action: string,
  details?: Record<string, unknown>
) {
  if (!user) return;
  await supabase.from('activity_logs').insert({
    admin_id: user.id,
    actor_email: user.email ?? '',
    actor_name: profileName,
    action,
    details: details ?? null,
  });
}
