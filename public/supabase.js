// Supabase connection: sign-in, and calls to the private AI function.
import {SUPABASE_URL, SUPABASE_KEY} from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
function isSecret(key) {
  if (/^sb_secret_/.test(key)) return true;
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; } catch { return false; }
}
export const keyProblem = configured && isSecret(SUPABASE_KEY)
  ? 'config.js contains a secret Supabase key. Replace it with the publishable key, then rotate the secret key in Supabase.' : '';

export const client = configured && !keyProblem ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true},
}) : null;

export async function currentSession() {
  if (!client) return null;
  const {data} = await client.auth.getSession();
  if (new URLSearchParams(location.search).has('code')) history.replaceState(null, '', location.pathname + location.hash);
  return data.session;
}
export async function sendLink(email) {
  const {error} = await client.auth.signInWithOtp({email, options: {shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname}});
  if (error) throw Error(error.status === 429 ? 'Too many sign-in emails. Wait a minute, then try again.' : 'The sign-in link could not be sent. Check that this email has an account in Supabase.');
}
export const signOut = () => client.auth.signOut();

export async function api(path, body, signal) {
  const {data: {session}} = await client.auth.getSession();
  if (!session) throw Error('Sign in again to use AI features.');
  let resp;
  try {
    resp = await fetch(SUPABASE_URL + '/functions/v1/ai/' + path, {
      method: body ? 'POST' : 'GET', signal,
      headers: {Authorization: 'Bearer ' + session.access_token, apikey: SUPABASE_KEY, ...(body ? {'Content-Type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw Error('The AI service could not be reached. Check your connection and retry.');
  }
  let data;
  try { data = await resp.json(); } catch { throw Error('The AI service did not respond. Check that the ai function is deployed.'); }
  if (!resp.ok) throw Error(data.error || data.message || 'The request failed. Try again.');
  return data;
}
