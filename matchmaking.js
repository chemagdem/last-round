import { authConfig } from './auth-config.js';

// Global "Find Match" queue, backed by the account.sql Migration 5 functions. Works without
// signing in - keyed by PeerJS peer id, not auth.uid(), the same way room-code PvP already
// requires no account. Loading this module never pulls in the Supabase SDK unless it's actually
// used (same lazy-import pattern as account.js).
let clientPromise = null;
function getClient(){
  if (!authConfig.url || !authConfig.publishableKey) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2.102.0')
      .then(({ createClient }) => createClient(authConfig.url, authConfig.publishableKey))
      .catch(() => null);
  }
  return clientPromise;
}

// Returns the opponent's peer id if one was already waiting (the caller should tear down
// whatever host peer it started and join that id instead), or null if the caller is now the one
// queued and waiting - in which case its own PeerJS 'connection' handler is what discovers the
// match, not anything read back from here.
export async function findOrQueue(peerId, ruleset, teamSize){
  const client = await getClient();
  if (!client) throw new Error('Matchmaking is not configured on this deployment.');
  const { data, error } = await client.rpc('find_or_queue', { p_peer_id: peerId, p_ruleset: ruleset, p_team_size: teamSize });
  if (error) throw error;
  return data || null;
}

export async function leaveQueue(peerId){
  const client = await getClient();
  if (!client) return;
  await client.rpc('leave_queue', { p_peer_id: peerId }).catch(() => {});
}
