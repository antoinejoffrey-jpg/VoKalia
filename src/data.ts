import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Profile = { id: string; display_name: string };
export type Server = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  tags: string[];
  banner_path: string | null;
};
export type Role = 'owner' | 'moderator' | 'member';
export type JoinedServer = { server_id: string; role: Role; server: Server };
export type Category = { id: string; server_id: string; name: string; position: number };
export type Channel = Category & { category_id: string; kind: 'text' | 'voice'; tags: string[] };
export type Member = { user_id: string; role: Role; display_name: string };
export type Workspace = { categories: Category[]; channels: Channel[] };
export type Thread = { id: string; member_a: string; member_b: string; other: Profile };
export type Message = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: Profile | null;
};
export type ConversationTarget = { type: 'channel' | 'direct'; id: string };
export type ServerInput = Pick<Server, 'name' | 'description' | 'visibility' | 'tags'>;

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

function validProjectUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const project = new URL(value);
    return (
      project.protocol === 'https:' ||
      (import.meta.env.DEV && ['127.0.0.1', 'localhost'].includes(project.hostname))
    );
  } catch {
    return false;
  }
}

export const client =
  validProjectUrl(url) && key?.startsWith('sb_publishable_')
    ? createClient(url!, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } })
    : null;

export const voiceEnabled = import.meta.env.VITE_VOICE_ENABLED === 'true';

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

export function read<T>({ data, error }: Result<T>): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export function errorText(error: unknown) {
  if (!(error instanceof Error)) return 'Une erreur est survenue. Réessaie dans un instant.';
  if (/fetch|network|failed to reach/i.test(error.message))
    return 'Connexion interrompue. Vérifie ton réseau et réessaie.';
  if (/violates row.level security|permission denied/i.test(error.message))
    return 'Ton compte n’a pas accès à cette action.';
  return error.message;
}

export async function profileFor(db: SupabaseClient, userId: string) {
  return read<Profile | null>(
    await db.from('vk_profiles').select('id,display_name').eq('id', userId).maybeSingle(),
  );
}

export async function joinedServers(db: SupabaseClient, userId: string) {
  return read<JoinedServer[]>(
    await db
      .from('vk_members')
      .select('server_id,role,server:vk_servers(*)')
      .eq('user_id', userId)
      .order('joined_at')
      .returns<JoinedServer[]>(),
  );
}

export async function workspaceFor(db: SupabaseClient, serverId: string): Promise<Workspace> {
  const [categories, channels] = await Promise.all([
    db
      .from('vk_categories')
      .select('*')
      .eq('server_id', serverId)
      .order('position')
      .order('id')
      .returns<Category[]>(),
    db
      .from('vk_channels')
      .select('*')
      .eq('server_id', serverId)
      .order('position')
      .order('id')
      .returns<Channel[]>(),
  ]);
  return { categories: read(categories), channels: read(channels) };
}

export async function threadsFor(db: SupabaseClient, userId: string) {
  type ThreadRow = Omit<Thread, 'other'> & { a: Profile; b: Profile };
  const rows = read<ThreadRow[]>(
    await db
      .from('vk_threads')
      .select(
        'id,member_a,member_b,a:vk_profiles!vk_threads_member_a_fkey(id,display_name),b:vk_profiles!vk_threads_member_b_fkey(id,display_name)',
      )
      .order('created_at', { ascending: false })
      .returns<ThreadRow[]>(),
  );
  return rows.map(({ id, member_a, member_b, a, b }) => ({
    id,
    member_a,
    member_b,
    other: member_a === userId ? b : a,
  }));
}

export function messageScope(target: ConversationTarget) {
  return target.type === 'channel'
    ? { table: 'vk_messages', foreignKey: 'channel_id' }
    : { table: 'vk_direct_messages', foreignKey: 'thread_id' };
}

export async function latestMessages(db: SupabaseClient, target: ConversationTarget, limit: number) {
  const { table, foreignKey } = messageScope(target);
  const rows = read<Message[]>(
    await db
      .from(table)
      .select('id,author_id,body,created_at,author:vk_profiles(id,display_name)')
      .eq(foreignKey, target.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
      .returns<Message[]>(),
  );
  return rows.reverse();
}

export function parseTags(text: string) {
  return [
    ...new Set(
      text
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, 6);
}

export async function prepareBanner(file: File, crop: 'top' | 'center' | 'bottom') {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('Choisis une image JPG, PNG ou WebP de moins de 12 Mo.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1440;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossible de préparer cette image.');
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    const y = crop === 'top' ? 0 : crop === 'bottom' ? canvas.height - height : (canvas.height - height) / 2;
    ctx.fillStyle = '#162940';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, (canvas.width - width) / 2, y, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob || blob.size > 2 * 1024 * 1024)
      throw new Error('Impossible de compresser la bannière sous 2 Mo.');
    return blob;
  } finally {
    bitmap.close();
  }
}

export async function createServer(
  db: SupabaseClient,
  userId: string,
  input: ServerInput,
  image: Blob | null,
) {
  const path = image ? `${userId}/${crypto.randomUUID()}.jpg` : null;
  const storage = db.storage.from('vokalia-banners');
  if (path && image) read(await storage.upload(path, image, { contentType: 'image/jpeg', upsert: false }));
  try {
    return read<string>(
      await db.rpc('vk_create_server', {
        p_name: input.name,
        p_description: input.description,
        p_visibility: input.visibility,
        p_tags: input.tags,
        p_banner: path,
      }),
    );
  } catch (error) {
    if (path) await storage.remove([path]).catch(() => undefined);
    throw error;
  }
}
