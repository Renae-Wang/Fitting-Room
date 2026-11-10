// Fitting Room AI: the only place the OpenAI key is used. Callable only by the owner's signed-in account.
import {createClient} from 'npm:@supabase/supabase-js@2';
import {AppError, perform} from '../_shared/provider.mjs';

const env = Deno.env.toObject();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false}});
const defaults: Record<string, number> = {select: 8, tag: 20, image: 3, realtime: 3};
const sizes: Record<string, number> = {image: 48 * 1024 * 1024, tag: 7 * 1024 * 1024, select: 1024 * 1024, realtime: 1024 * 1024};
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {status, headers: {...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});

function limits() {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const raw = env['DAILY_' + key.toUpperCase() + '_LIMIT'];
    const value = raw == null || raw === '' ? fallback : Number(raw);
    return [key, Number.isSafeInteger(value) && value >= 0 && value <= 10000 ? value : fallback];
  }));
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const {data: {user}} = await admin.auth.getUser(token);
    if (!user) throw new AppError(401, 'Sign in again to use AI features.');
    const owner = (env.OWNER_EMAIL || '').trim().toLowerCase();
    if (!owner) throw new AppError(503, 'Add OWNER_EMAIL to the Supabase function secrets.');
    if ((user.email || '').toLowerCase() !== owner) throw new AppError(403, 'This account cannot use AI features.');

    const route = new URL(req.url).pathname.split('/').pop() || '';
    const lim = limits();
    const enabled = env.ENABLE_PAID_API === 'true' && Boolean(env.OPENAI_API_KEY?.trim());

    if (route === 'status' && req.method === 'GET') {
      const day = new Date().toISOString().slice(0, 10);
      const {data} = await admin.from('usage').select('route,used').eq('user_id', user.id).eq('day', day);
      const used = Object.fromEntries((data || []).map(r => [r.route, r.used]));
      return json(200, {enabled, limits: lim, remaining: Object.fromEntries(Object.keys(lim).map(k => [k, Math.max(0, lim[k] - (used[k] || 0))]))});
    }
    if (!Object.hasOwn(lim, route)) throw new AppError(404, 'Unknown AI request.');
    if (req.method !== 'POST') throw new AppError(405, 'Use POST.');
    if (!enabled) throw new AppError(503, 'Paid AI is off. Add OPENAI_API_KEY and set ENABLE_PAID_API to true in the Supabase function secrets.');
    if (Number(req.headers.get('content-length')) > sizes[route]) throw new AppError(413, 'Request exceeds the size limit. Resize the reference photos.');
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'Expected a JSON object.');

    const reserve = async () => {
      const {data, error} = await admin.rpc('reserve_usage', {p_user: user.id, p_route: route, p_limit: lim[route]});
      if (error) throw new AppError(500, 'Daily limits could not be checked. Try again.');
      if (!data) throw new AppError(429, 'Daily ' + route + ' request limit reached. Resets at 00:00 UTC.');
    };
    return json(200, await perform(route, body, {env, fetchImpl: fetch, reserve}));
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return json(status, {error: e instanceof AppError ? e.message : 'The AI service hit an error. Try again.'});
  }
});
