import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { AccessToken, TrackSource } from 'npm:livekit-server-sdk@2.19.2';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function projectKey() {
  const values = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (values) {
    const keys = JSON.parse(values) as Record<string, string>;
    if (keys.default) return keys.default;
  }
  return Deno.env.get('SUPABASE_ANON_KEY');
}

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  const allowedOrigins = (Deno.env.get('VK_WEB_ORIGINS') ?? '').split(',').map(value => value.trim());
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  function reply(status: number, body: Record<string, string>) {
    return Response.json(body, { status, headers });
  }

  if (origin) {
    if (!allowedOrigins.includes(origin)) return reply(403, { error: 'Origine non autorisée.' });
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: 'Méthode non autorisée.' });

  const auth = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
  if (!auth) return reply(401, { error: 'Connecte-toi pour rejoindre le vocal.' });

  let channelId: unknown;
  try {
    channelId = (await request.json())?.channelId;
  } catch {
    return reply(400, { error: 'Requête invalide.' });
  }
  if (typeof channelId !== 'string' || !uuid.test(channelId)) return reply(400, { error: 'Salon invalide.' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const key = projectKey();
    if (!supabaseUrl || !key) return reply(503, { error: 'Le service vocal est indisponible.' });
    const db = createClient(supabaseUrl, key, {
      global: { headers: { Authorization: `Bearer ${auth[1]}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(auth[1]);
    if (authError || !user || user.is_anonymous || !user.email_confirmed_at) {
      return reply(401, { error: 'Une session avec une adresse confirmée est requise.' });
    }

    // The RPC runs with the caller's JWT and the channel membership RLS policy.
    const { data: channel, error: channelError } = await db.rpc('vk_voice_room', { p_channel: channelId });
    if (channelError || !channel?.id || !channel?.server_id)
      return reply(403, { error: 'Tu ne peux pas accéder à ce salon.' });
    const { data: profile } = await db
      .from('vk_profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.display_name)
      return reply(403, { error: 'Ton profil est requis pour rejoindre le vocal.' });

    const livekitUrl = Deno.env.get('LIVEKIT_URL');
    const apiKey = Deno.env.get('LIVEKIT_API_KEY');
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    if (!livekitUrl?.startsWith('wss://') || !apiKey || !apiSecret) {
      return reply(503, { error: 'Le service vocal est en cours de configuration.' });
    }
    const token = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name: profile.display_name,
      ttl: '2m',
    });
    token.addGrant({
      roomJoin: true,
      room: `vk-${channel.server_id}-${channel.id}`,
      canSubscribe: true,
      canPublish: true,
      canPublishData: false,
      canPublishSources: [TrackSource.MICROPHONE],
    });
    return reply(200, { url: livekitUrl, token: await token.toJwt() });
  } catch {
    return reply(503, { error: 'Le service vocal est indisponible.' });
  }
});
