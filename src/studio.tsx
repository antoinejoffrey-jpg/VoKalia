import { useCallback, useState, type FormEvent } from 'react';
import {
  AudioLines,
  Compass,
  Globe2,
  Hash,
  Headphones,
  Layers3,
  Link2,
  Lock,
  LogOut,
  MessageCircle,
  PhoneOff,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  errorText,
  joinedServers,
  read,
  threadsFor,
  workspaceFor,
  type JoinedServer,
  type Member,
  type Profile,
  type Server,
} from './data';
import { useOnlineMembers, usePresence, useResource } from './hooks';
import { Conversation } from './conversation';
import { CreateServerForm, CreateSpaceForm } from './forms';
import { Avatar, Brand, ErrorNotice, Loading, Modal } from './ui';
import { useVoice, VoicePanel } from './voice';

type Screen = 'servers' | 'explore' | 'messages';

function Banner({ db, server, small = false }: { db: SupabaseClient; server: Server; small?: boolean }) {
  const loadImage = useCallback(async () => {
    if (!server.banner_path) return null;
    const image = read(await db.storage.from('vokalia-banners').createSignedUrl(server.banner_path, 300));
    return image.signedUrl;
  }, [db, server.banner_path]);
  const { data: image } = useResource(server.banner_path ? loadImage : null);
  const Visibility = server.visibility === 'private' ? Lock : Globe2;
  return (
    <div className={`server-banner ${small ? 'compact' : ''}`}>
      {image && <img src={image} alt="" />}
      <div className="banner-copy">
        <p className="eyebrow">
          <Visibility size={13} aria-hidden />
          {server.visibility === 'private' ? 'Sur invitation' : 'Serveur public'}
        </p>
        {small ? <h3>{server.name}</h3> : <h1>{server.name}</h1>}
        {server.description && <p>{server.description}</p>}
        {server.tags.length > 0 && (
          <div className="tags">
            {server.tags.map((tag, index) => (
              <span key={`${tag}-${index}`}>{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberList({
  members,
  self,
  openThread,
}: {
  members: Member[];
  self: Profile;
  openThread: (userId: string) => void;
}) {
  return (
    <div className="member-list">
      {!members.length && <p className="muted small-text">Aucun membre connecté.</p>}
      {members.map(member => (
        <div className="member" key={member.user_id}>
          <Avatar name={member.display_name} />
          <div>
            <strong>
              {member.display_name}
              {member.user_id === self.id ? ' · toi' : ''}
            </strong>
            <small>
              <span className="online-dot" />
              En ligne
            </small>
          </div>
          {member.user_id !== self.id && (
            <button
              className="icon-button"
              type="button"
              onClick={() => openThread(member.user_id)}
              aria-label={`Écrire à ${member.display_name}`}
            >
              <MessageCircle size={17} aria-hidden />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ServerView({
  db,
  self,
  entry,
  voice,
  openThread,
}: {
  db: SupabaseClient;
  self: Profile;
  entry: JoinedServer;
  voice: ReturnType<typeof useVoice>;
  openThread: (id: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<{ mode: 'category' | 'channel'; categoryId?: string } | null>(null);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [invite, setInvite] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => workspaceFor(db, entry.server_id), [db, entry.server_id]);
  const workspace = useResource(load);
  const online = useOnlineMembers(db, entry.server_id);
  const members = online.data ?? [];
  const canManage = entry.role === 'owner' || entry.role === 'moderator';
  const channel =
    workspace.data?.channels.find(room => room.id === selected) ??
    workspace.data?.channels.find(room => room.kind === 'text') ??
    workspace.data?.channels[0];

  async function makeInvite() {
    setInviteBusy(true);
    setError('');
    try {
      const code = read<string>(await db.rpc('vk_make_invite', { p_server: entry.server_id }));
      const link = new URL('.', window.location.href);
      link.searchParams.set('invite', code);
      setCopyStatus('');
      setInvite(link.href);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopyStatus('Lien copié.');
    } catch {
      setCopyStatus('Sélectionne le lien pour le copier.');
    }
  }

  return (
    <>
      <Banner db={db} server={entry.server} />
      <div className="server-tools">
        <button className="button secondary" type="button" onClick={() => setOnlineOpen(true)}>
          <Users size={16} aria-hidden />
          {online.data ? `${members.length} en ligne` : 'Membres en ligne'}
        </button>
        {canManage && (
          <button
            className="button secondary"
            type="button"
            disabled={inviteBusy}
            onClick={() => void makeInvite()}
          >
            <Link2 size={16} aria-hidden />
            {inviteBusy ? 'Création du lien…' : 'Inviter'}
          </button>
        )}
      </div>
      <ErrorNotice text={error} />
      <ErrorNotice text={workspace.error} />
      {workspace.loading && <Loading text="Ouverture des salons…" />}
      {workspace.data && (
        <div className="studio-grid">
          <aside className="panel room-sidebar" aria-label="Catégories et salons">
            <div className="sidebar-title">
              <h2>Salons</h2>
            </div>
            {workspace.data.categories.map(category => (
              <section className="room-category" key={category.id}>
                <header>
                  <h3>{category.name}</h3>
                  {canManage && (
                    <button
                      className="button secondary add-room"
                      type="button"
                      aria-label={`Ajouter un salon dans ${category.name}`}
                      onClick={() => setForm({ mode: 'channel', categoryId: category.id })}
                    >
                      <Plus size={14} aria-hidden />
                      Salon
                    </button>
                  )}
                </header>
                {workspace
                  .data!.channels.filter(room => room.category_id === category.id)
                  .map(room => {
                    const Icon = room.kind === 'voice' ? Headphones : Hash;
                    return (
                      <button
                        className={`room-link ${channel?.id === room.id ? 'active' : ''}`}
                        key={room.id}
                        type="button"
                        aria-pressed={channel?.id === room.id}
                        onClick={() => setSelected(room.id)}
                      >
                        <Icon size={16} aria-hidden />
                        {room.name}
                      </button>
                    );
                  })}
              </section>
            ))}
            {canManage && (
              <button
                className="button secondary add-category"
                type="button"
                onClick={() => setForm({ mode: 'category' })}
              >
                <Plus size={16} aria-hidden />
                Nouvelle catégorie
              </button>
            )}
          </aside>
          {channel ? (
            channel.kind === 'voice' ? (
              <VoicePanel channel={channel} voice={voice} />
            ) : (
              <Conversation
                key={channel.id}
                db={db}
                self={self}
                title={channel.name}
                target={{ type: 'channel', id: channel.id }}
              />
            )
          ) : (
            <div className="panel empty-state">
              <h2>Ajoute un salon pour commencer.</h2>
            </div>
          )}
          <aside className="panel online-sidebar">
            <div className="sidebar-title">
              <h2>En ligne</h2>
              <span className="count">{online.data ? members.length : '…'}</span>
            </div>
            <ErrorNotice text={online.error} />
            {online.loading ? (
              <Loading />
            ) : (
              <MemberList members={members} self={self} openThread={openThread} />
            )}
          </aside>
        </div>
      )}
      {form && workspace.data && (
        <CreateSpaceForm
          db={db}
          serverId={entry.server_id}
          categories={workspace.data.categories}
          {...form}
          close={() => setForm(null)}
          saved={channelId => {
            setForm(null);
            workspace.refresh();
            if (channelId) setSelected(channelId);
          }}
        />
      )}
      {onlineOpen && (
        <Modal title="Membres en ligne" close={() => setOnlineOpen(false)}>
          <ErrorNotice text={online.error} />
          {online.loading ? (
            <Loading />
          ) : (
            <MemberList
              members={members}
              self={self}
              openThread={id => {
                setOnlineOpen(false);
                openThread(id);
              }}
            />
          )}
        </Modal>
      )}
      {invite && (
        <Modal title="Inviter dans ton serveur" close={() => setInvite('')}>
          <div className="stack">
            <p className="muted">
              Ce lien est valable sept jours et permet dix nouvelles inscriptions au serveur.
            </p>
            <label>
              Lien d’invitation
              <input value={invite} readOnly onFocus={event => event.currentTarget.select()} />
            </label>
            <button className="button primary" type="button" onClick={() => void copyInvite()}>
              Copier le lien
            </button>
            {copyStatus && (
              <p className="muted small-text" role="status">
                {copyStatus}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function Explorer({
  db,
  joined,
  open,
}: {
  db: SupabaseClient;
  joined: JoinedServer[];
  open: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(
    async () => read<Server[]>(await db.rpc('vk_find_servers', { p_search: search })),
    [db, search],
  );
  const results = useResource(load);

  async function join(server: Server) {
    if (joined.some(entry => entry.server_id === server.id)) {
      open(server.id);
      return;
    }
    setPending(server.id);
    setError('');
    try {
      open(read<string>(await db.rpc('vk_join_server', { p_server: server.id })));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending('');
    }
  }

  return (
    <section className="explore">
      <div className="page-heading">
        <p className="eyebrow">Découverte</p>
        <h1>Trouve ton univers.</h1>
        <p>Explore les serveurs publics par nom ou par mot-clé.</p>
      </div>
      <form
        className="search-form"
        onSubmit={event => {
          event.preventDefault();
          setSearch(draft.trim());
        }}
      >
        <input
          type="search"
          aria-label="Rechercher des serveurs"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Cinéma, musique, gaming…"
          maxLength={80}
        />
        <button className="button primary" type="submit">
          <Search size={17} aria-hidden />
          Chercher
        </button>
      </form>
      <ErrorNotice text={error || results.error} />
      {results.loading && <Loading />}
      {results.data?.length === 0 && (
        <div className="panel empty-state">
          <Compass size={28} aria-hidden />
          <h2>Aucun serveur trouvé.</h2>
          <p>Essaie un autre mot-clé ou crée ton propre espace.</p>
        </div>
      )}
      <div className="directory">
        {results.data?.map(server => (
          <article className="panel discovery-card" key={server.id}>
            <Banner db={db} server={server} small />
            <button
              className="button secondary"
              type="button"
              disabled={Boolean(pending)}
              onClick={() => void join(server)}
            >
              {pending === server.id
                ? 'Ouverture…'
                : joined.some(entry => entry.server_id === server.id)
                  ? 'Ouvrir'
                  : 'Rejoindre'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Messages({
  db,
  profile,
  threadId,
  select,
}: {
  db: SupabaseClient;
  profile: Profile;
  threadId: string;
  select: (id: string) => void;
}) {
  const load = useCallback(() => threadsFor(db, profile.id), [db, profile.id, threadId]);
  const threads = useResource(load);
  const active = threads.data?.find(thread => thread.id === threadId) ?? threads.data?.[0];
  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow">Conversations privées</p>
        <h1>Messages.</h1>
      </div>
      <ErrorNotice text={threads.error} />
      {threads.loading && <Loading />}
      {threads.data?.length === 0 && (
        <div className="panel empty-state">
          <MessageCircle size={28} aria-hidden />
          <h2>Ta boîte est vide.</h2>
          <p>Depuis un serveur, choisis un membre en ligne pour lui écrire.</p>
        </div>
      )}
      {active && (
        <div className="direct-layout">
          <aside className="panel thread-list" aria-label="Conversations">
            {threads.data?.map(thread => (
              <button
                type="button"
                className={`thread ${thread.id === active.id ? 'active' : ''}`}
                key={thread.id}
                onClick={() => select(thread.id)}
              >
                <Avatar name={thread.other.display_name} />
                <strong>{thread.other.display_name}</strong>
              </button>
            ))}
          </aside>
          <Conversation
            key={active.id}
            db={db}
            self={profile}
            title={active.other.display_name}
            target={{ type: 'direct', id: active.id }}
          />
        </div>
      )}
    </section>
  );
}

export function Studio({
  db,
  profile,
  pendingInvite,
  clearInvite,
}: {
  db: SupabaseClient;
  profile: Profile;
  pendingInvite: string;
  clearInvite: () => void;
}) {
  const [screen, setScreen] = useState<Screen>('servers');
  const [serverId, setServerId] = useState('');
  const [threadId, setThreadId] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const load = useCallback(() => joinedServers(db, profile.id), [db, profile.id]);
  const joined = useResource(load);
  const active =
    joined.data?.find(entry => entry.server_id === serverId) ?? (serverId ? undefined : joined.data?.[0]);
  const stopPresence = usePresence(db, profile.id);
  const voice = useVoice(db);

  function openServer(id: string) {
    setCreating(false);
    setServerId(id);
    setScreen('servers');
    joined.refresh();
  }

  async function openThread(userId: string) {
    setError('');
    try {
      setThreadId(read<string>(await db.rpc('vk_open_thread', { p_user: userId })));
      setScreen('messages');
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  async function acceptInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingInvite || joining) return;
    setJoining(true);
    setError('');
    try {
      openServer(read<string>(await db.rpc('vk_accept_invite', { p_code: pendingInvite })));
      clearInvite();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setJoining(false);
    }
  }

  async function signOut() {
    await Promise.allSettled([stopPresence(), voice.leave()]);
    const result = await db.auth.signOut({ scope: 'local' });
    if (result.error) setError(errorText(result.error));
  }

  const tabs = [
    { id: 'servers', label: 'Serveurs', icon: Layers3 },
    { id: 'explore', label: 'Explorer', icon: Compass },
    { id: 'messages', label: 'Messages', icon: MessageCircle },
  ] as const;
  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <nav aria-label="Navigation principale">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={screen === id}
              onClick={() => {
                setError('');
                setScreen(id);
              }}
            >
              <Icon size={17} aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <div className="account-actions">
          <button
            className="button primary create-button"
            type="button"
            aria-label="Créer un serveur"
            onClick={() => setCreating(true)}
          >
            <Plus size={17} aria-hidden />
            <span>Créer</span>
          </button>
          <button
            className="account-avatar"
            type="button"
            aria-label="Mon profil"
            onClick={() => setProfileOpen(true)}
          >
            <Avatar name={profile.display_name} />
          </button>
        </div>
      </header>
      <main className="app-body">
        <ErrorNotice text={error || joined.error} />
        {joined.error && (
          <button className="button secondary" type="button" onClick={joined.refresh}>
            Réessayer
          </button>
        )}
        {pendingInvite && (
          <form className="invite-prompt panel" onSubmit={acceptInvite}>
            <div>
              <strong>Tu as une invitation</strong>
              <p>Rejoins le serveur qui t’a invité.</p>
            </div>
            <button className="button primary" type="submit" disabled={joining}>
              {joining ? 'Ouverture…' : 'Accepter'}
            </button>
            <button className="button secondary" type="button" onClick={clearInvite}>
              Ignorer
            </button>
          </form>
        )}
        {voice.state && (
          <div className="voice-dock">
            <AudioLines size={17} aria-hidden />
            <span>
              {voice.state.phase === 'live'
                ? 'Dans le vocal'
                : voice.state.phase === 'joining'
                  ? 'Connexion'
                  : 'Reconnexion'}{' '}
              · {voice.state.channel.name}
            </span>
            <button
              className="icon-button"
              aria-label="Quitter le vocal"
              type="button"
              onClick={() => void voice.leave()}
            >
              <PhoneOff size={17} aria-hidden />
            </button>
          </div>
        )}
        {screen === 'servers' && (
          <>
            {!!joined.data?.length && (
              <label className="server-picker">
                Mes serveurs
                <select
                  value={active?.server_id ?? serverId}
                  onChange={event => setServerId(event.target.value)}
                >
                  {serverId && !active && <option value={serverId}>Ouverture…</option>}
                  {joined.data.map(entry => (
                    <option key={entry.server_id} value={entry.server_id}>
                      {entry.server.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {joined.loading && <Loading text="Chargement des serveurs…" />}
            {active && (
              <ServerView
                key={active.server_id}
                db={db}
                self={profile}
                entry={active}
                voice={voice}
                openThread={id => void openThread(id)}
              />
            )}
            {joined.data && !active && !serverId && (
              <section className="panel empty-state first-server">
                <span className="section-icon">
                  <Layers3 size={26} aria-hidden />
                </span>
                <h1>Un premier espace à toi.</h1>
                <p>Crée ton serveur ou explore les communautés publiques.</p>
                <div className="button-row">
                  <button className="button primary" type="button" onClick={() => setCreating(true)}>
                    Créer un serveur
                  </button>
                  <button className="button secondary" type="button" onClick={() => setScreen('explore')}>
                    Explorer
                  </button>
                </div>
              </section>
            )}
            {serverId && !active && !joined.error && <Loading text="Ouverture du serveur…" />}
          </>
        )}
        {screen === 'explore' && <Explorer db={db} joined={joined.data ?? []} open={openServer} />}
        {screen === 'messages' && (
          <Messages db={db} profile={profile} threadId={threadId} select={setThreadId} />
        )}
      </main>
      {creating && (
        <CreateServerForm db={db} userId={profile.id} close={() => setCreating(false)} created={openServer} />
      )}
      {profileOpen && (
        <Modal title="Ton profil" close={() => setProfileOpen(false)}>
          <div className="profile-summary">
            <Avatar name={profile.display_name} size="large" />
            <div>
              <h3>{profile.display_name}</h3>
              <p className="muted">Adresse e-mail confirmée</p>
            </div>
          </div>
          <button className="button secondary" type="button" onClick={() => void signOut()}>
            <LogOut size={17} aria-hidden />
            Se déconnecter
          </button>
        </Modal>
      )}
    </div>
  );
}
