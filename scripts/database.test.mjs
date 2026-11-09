import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const unconfirmed = '44444444-4444-4444-8444-444444444444';
const connectionOne = '55555555-5555-4555-8555-555555555555';
const connectionTwo = '66666666-6666-4666-8666-666666666666';

test('VoKalia protects server, voice, presence, banners and private messages at the database', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  // The test database supplies the schemas and JWT identity helpers provided by hosted Supabase.
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}');
    $$;
    grant usage on schema auth to anon, authenticated;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    create publication supabase_realtime;
    -- Simulate projects which still have broad default grants on public tables.
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
  for (const id of [alice, bob, outsider, unconfirmed]) {
    await db.query('insert into auth.users(id,email_confirmed_at) values ($1,$2)', [
      id,
      id === unconfirmed ? null : new Date(),
    ]);
  }

  async function actAs(id, role = 'authenticated', anonymous = false) {
    await db.exec('reset role');
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
      [id ?? '', JSON.stringify({ is_anonymous: anonymous })],
    );
    await db.exec(role === 'anon' ? 'set role anon' : 'set role authenticated');
  }

  async function scalar(sql, args = []) {
    const { rows } = await db.query(sql, args);
    return rows[0]?.value;
  }

  await t.test('only a confirmed, non-anonymous account can create a profile', async () => {
    await actAs(unconfirmed);
    await assert.rejects(db.query("select public.vk_save_profile('Non confirmé')"), /row-level security/);
    await actAs(alice, 'authenticated', true);
    await assert.rejects(db.query("select public.vk_save_profile('Anonyme')"), /row-level security/);
    await actAs(null, 'anon');
    await assert.rejects(db.query('select * from public.vk_servers'), /permission denied/);
    for (const [id, name] of [
      [alice, 'Alice'],
      [bob, 'Bob'],
      [outsider, 'Visiteur'],
    ]) {
      await actAs(id);
      await db.query('select public.vk_save_profile($1)', [name]);
    }
  });

  const banner = `${alice}/${connectionOne}.jpg`;
  await actAs(alice);
  await db.query("insert into storage.objects(bucket_id,name) values ('vokalia-banners',$1)", [banner]);
  const privateServer = await scalar(
    "select public.vk_create_server('Cinéma privé','', 'private',array['secretcinema'],$1) as value",
    [banner],
  );
  const publicServer = await scalar(
    "select public.vk_create_server('Le labo sonore','', 'public',array['musique'],null) as value",
  );
  const privateRooms = (
    await db.query(
      'select id,kind,category_id from public.vk_channels where server_id=$1 order by position',
      [privateServer],
    )
  ).rows;
  assert.deepEqual(
    privateRooms.map(room => room.kind),
    ['text', 'voice'],
  );
  const textRoom = privateRooms[0].id;
  const voiceRoom = privateRooms[1].id;
  await db.query("insert into public.vk_messages(channel_id,body) values ($1,'Texte réservé')", [textRoom]);
  const code = await scalar('select public.vk_make_invite($1) as value', [privateServer]);

  await t.test('a public directory never exposes private server tags or rooms', async () => {
    const publicCategory = await scalar('select id as value from public.vk_categories where server_id=$1', [
      publicServer,
    ]);
    await db.query(
      "insert into public.vk_channels(server_id,category_id,name,kind,tags) values ($1,$2,'Guitares','text',array['sixcordes'])",
      [publicServer, publicCategory],
    );
    await actAs(outsider);
    assert.equal(
      await scalar("select count(*)::int as value from public.vk_find_servers('secretcinema')"),
      0,
    );
    assert.equal(await scalar("select id as value from public.vk_find_servers('sixcordes')"), publicServer);
    assert.equal(
      await scalar('select count(*)::int as value from public.vk_channels where server_id=$1', [
        publicServer,
      ]),
      0,
    );
  });

  await t.test(
    'an outsider cannot read, post, see presence, download a private banner or join voice',
    async () => {
      await actAs(outsider);
      assert.equal(
        await scalar('select count(*)::int as value from public.vk_messages where channel_id=$1', [textRoom]),
        0,
      );
      assert.equal(await scalar('select public.vk_voice_room($1) as value', [voiceRoom]), null);
      assert.equal(
        await scalar('select count(*)::int as value from public.vk_online_members($1)', [privateServer]),
        0,
      );
      assert.equal(
        await scalar('select count(*)::int as value from storage.objects where name=$1', [banner]),
        0,
      );
      await assert.rejects(
        db.query("insert into public.vk_messages(channel_id,body) values ($1,'Intrusion')", [textRoom]),
        /row-level security/,
      );
      await assert.rejects(
        db.query('select public.vk_join_server($1)', [privateServer]),
        /nécessite une invitation/,
      );
      await assert.rejects(
        db.query('select public.vk_make_invite($1)', [privateServer]),
        /ne peux pas inviter/,
      );
      await assert.rejects(
        db.query("insert into storage.objects(bucket_id,name) values ('vokalia-banners',$1)", [
          `${alice}/${connectionTwo}.jpg`,
        ]),
        /row-level security/,
      );
    },
  );

  await t.test('an invite grants membership, never ownership or a cross-server category', async () => {
    await actAs(bob);
    assert.equal(await scalar('select public.vk_accept_invite($1) as value', [code]), privateServer);
    assert.equal(await scalar('select public.vk_accept_invite($1) as value', [code]), privateServer);
    assert.equal(
      await scalar('select role as value from public.vk_members where server_id=$1 and user_id=$2', [
        privateServer,
        bob,
      ]),
      'member',
    );
    assert.equal(
      await scalar('select body as value from public.vk_messages where channel_id=$1', [textRoom]),
      'Texte réservé',
    );
    assert.equal((await scalar('select public.vk_voice_room($1) as value', [voiceRoom])).id, voiceRoom);
    assert.equal(
      await scalar('select count(*)::int as value from storage.objects where name=$1', [banner]),
      1,
    );
    await assert.rejects(
      db.query("insert into public.vk_categories(server_id,name) values ($1,'Intrusion')", [privateServer]),
      /row-level security/,
    );
    await assert.rejects(
      db.query("insert into public.vk_messages(channel_id,author_id,body) values ($1,$2,'Usurpation')", [
        textRoom,
        alice,
      ]),
      /permission denied/,
    );
    await actAs(alice);
    await assert.rejects(
      db.query(
        "insert into public.vk_channels(server_id,category_id,name,kind) values ($1,$2,'Mauvaise catégorie','text')",
        [publicServer, privateRooms[0].category_id],
      ),
      /foreign key/,
    );
    await db.exec('reset role');
    assert.equal(await scalar('select uses_remaining as value from vokalia_private.invites'), 9);
  });

  await t.test('direct conversations are unique per pair and inaccessible to a third account', async () => {
    await actAs(alice);
    const thread = await scalar('select public.vk_open_thread($1) as value', [bob]);
    await db.query("insert into public.vk_direct_messages(thread_id,body) values ($1,'Entre nous')", [
      thread,
    ]);
    await actAs(bob);
    assert.equal(await scalar('select public.vk_open_thread($1) as value', [alice]), thread);
    assert.equal(
      await scalar('select body as value from public.vk_direct_messages where thread_id=$1', [thread]),
      'Entre nous',
    );
    await actAs(outsider);
    assert.equal(
      await scalar('select count(*)::int as value from public.vk_direct_messages where thread_id=$1', [
        thread,
      ]),
      0,
    );
    await assert.rejects(
      db.query("insert into public.vk_direct_messages(thread_id,body) values ($1,'Intrusion')", [thread]),
      /row-level security/,
    );
    await assert.rejects(db.query('select public.vk_open_thread($1)', [alice]), /partager un serveur/);
  });

  await t.test(
    'one online member is counted once across tabs and disappears when all connections end',
    async () => {
      await actAs(bob);
      await db.query('select public.vk_touch_connection($1)', [connectionOne]);
      await db.query('select public.vk_touch_connection($1)', [connectionTwo]);
      await actAs(alice);
      assert.equal(
        await scalar('select count(*)::int as value from public.vk_online_members($1)', [privateServer]),
        1,
      );
      await db.query('select public.vk_end_connection($1)', [connectionTwo]);
      await actAs(bob);
      await db.query('select public.vk_end_connection($1)', [connectionOne]);
      assert.equal(
        await scalar('select count(*)::int as value from public.vk_online_members($1)', [privateServer]),
        1,
      );
      await db.query('select public.vk_end_connection($1)', [connectionTwo]);
      assert.equal(
        await scalar('select count(*)::int as value from public.vk_online_members($1)', [privateServer]),
        0,
      );
    },
  );
});
