import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, ArrowRight, ShieldCheck } from 'lucide-react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { client, errorText, profileFor, read } from './data';
import { useResource } from './hooks';
import { Studio } from './studio';
import { Brand, ErrorNotice, Loading } from './ui';
import './styles.css';

const inviteStorage = 'vokalia.pendingInvite';
const invitePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function initialInvite() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('invite');
  if (code) {
    if (invitePattern.test(code)) sessionStorage.setItem(inviteStorage, code);
    url.searchParams.delete('invite');
    history.replaceState(history.state, '', url);
  }
  return sessionStorage.getItem(inviteStorage) ?? '';
}

function Welcome({
  db,
  pendingInvite,
  initialError = '',
}: {
  db: SupabaseClient | null;
  pendingInvite: string;
  initialError?: string;
}) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (!db || busy) return;
    setBusy(true);
    setError('');
    try {
      const redirect = new URL('.', window.location.href).href;
      const result = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect } });
      if (result.error) throw result.error;
    } catch (failure) {
      setBusy(false);
      setError(errorText(failure));
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-top">
        <Brand />
        <span>Communautés · Conversations · Vocal</span>
      </div>
      <main className="welcome-main">
        <section className="welcome-art">
          <div className="studio-orbit" aria-hidden>
            <div className="orbit-inner">
              <AudioLines size={70} />
            </div>
          </div>
          <div className="welcome-copy">
            <p className="eyebrow">Le studio VoKalia</p>
            <h1>De la place pour toutes tes passions.</h1>
            <p>Crée ton serveur, retrouve tes amis et passe du texte au vocal en un clic.</p>
            <div className="tags">
              <span>Cinéma</span>
              <span>Musique</span>
              <span>Gaming</span>
              <span>Et tout le reste</span>
            </div>
          </div>
        </section>
        <section className="login-card">
          <span className="section-icon">
            <AudioLines size={23} aria-hidden />
          </span>
          <p className="eyebrow">Ton espace</p>
          <h2>Bienvenue sur VoKalia.</h2>
          <p className="muted">Connecte-toi pour retrouver tes serveurs et tes conversations.</p>
          {pendingInvite && <p className="notice">Tu as une invitation. Connecte-toi pour l’ouvrir.</p>}
          <button
            className="button primary google"
            type="button"
            disabled={busy || !db}
            onClick={() => void connect()}
          >
            {busy ? 'Connexion…' : 'Continuer avec Google'}
            <ArrowRight size={18} aria-hidden />
          </button>
          {!db && (
            <p className="notice">
              Aperçu local. La connexion s’activera quand le projet Supabase sera raccordé.
            </p>
          )}
          <ErrorNotice text={error} />
          <div className="privacy-note">
            <ShieldCheck size={16} aria-hidden />
            <span>Ton adresse e-mail reste privée.</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function ProfileSetup({ db, session, done }: { db: SupabaseClient; session: Session; done: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    setBusy(true);
    setError('');
    try {
      read(await db.rpc('vk_save_profile', { p_name: name }));
      done();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <Brand />
      <section className="panel setup-card">
        <p className="eyebrow">Ton profil</p>
        <h1>Comment on t’appelle ?</h1>
        <p className="muted">Choisis le pseudo que les membres verront sur tes serveurs.</p>
        {session.user.email_confirmed_at ? (
          <form className="stack" onSubmit={submit}>
            <label>
              Pseudo
              <input name="name" autoFocus minLength={2} maxLength={48} required placeholder="Ton pseudo" />
            </label>
            <ErrorNotice text={error} />
            <button className="button primary" disabled={busy} type="submit">
              {busy ? 'Enregistrement…' : 'Entrer dans VoKalia'}
            </button>
          </form>
        ) : (
          <p className="notice">Confirme ton adresse e-mail avant de créer ton profil.</p>
        )}
        <button
          className="button secondary"
          type="button"
          onClick={() => void db.auth.signOut({ scope: 'local' })}
        >
          Changer de compte
        </button>
      </section>
    </main>
  );
}

function SignedIn({
  db,
  session,
  pendingInvite,
  clearInvite,
}: {
  db: SupabaseClient;
  session: Session;
  pendingInvite: string;
  clearInvite: () => void;
}) {
  const loadProfile = useCallback(() => profileFor(db, session.user.id), [db, session.user.id]);
  const profile = useResource(loadProfile);
  if (profile.loading || profile.error)
    return (
      <main className="center-page">
        <Brand />
        {profile.loading && <Loading text="Ouverture de ton espace…" />}
        <ErrorNotice text={profile.error} />
        {profile.error && (
          <button className="button secondary" type="button" onClick={profile.refresh}>
            Réessayer
          </button>
        )}
      </main>
    );
  if (!profile.data) return <ProfileSetup db={db} session={session} done={profile.refresh} />;
  return <Studio db={db} profile={profile.data} pendingInvite={pendingInvite} clearInvite={clearInvite} />;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [waiting, setWaiting] = useState(Boolean(client));
  const [sessionError, setSessionError] = useState('');
  const [pendingInvite, setPendingInvite] = useState(initialInvite);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, next) => {
      if (alive) setSession(next);
    });
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setSessionError(errorText(error));
        setSession(data.session);
        setWaiting(false);
      })
      .catch(error => {
        if (alive) {
          setSessionError(errorText(error));
          setWaiting(false);
        }
      });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  function clearInvite() {
    sessionStorage.removeItem(inviteStorage);
    setPendingInvite('');
  }

  if (waiting)
    return (
      <main className="center-page">
        <Brand />
        <Loading />
      </main>
    );
  return client && session ? (
    <SignedIn
      key={session.user.id}
      db={client}
      session={session}
      pendingInvite={pendingInvite}
      clearInvite={clearInvite}
    />
  ) : (
    <Welcome db={client} pendingInvite={pendingInvite} initialError={sessionError} />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
