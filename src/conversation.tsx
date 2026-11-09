import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Hash, Lock, Send } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorText, latestMessages, messageScope, read, type ConversationTarget, type Profile } from './data';
import { useResource } from './hooks';
import { Avatar, ErrorNotice, Loading } from './ui';

const dateFormat = new Intl.DateTimeFormat('fr-BE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function Conversation({
  db,
  self,
  target,
  title,
}: {
  db: SupabaseClient;
  self: Profile;
  target: ConversationTarget;
  title: string;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState('');
  const [connected, setConnected] = useState(false);
  const [limit, setLimit] = useState(50);
  const feed = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const nearEnd = useRef(true);
  const preservePosition = useRef<number | null>(null);
  const { id, type } = target;
  const load = useCallback(() => latestMessages(db, { type, id }, limit), [db, type, id, limit]);
  const messages = useResource(load);

  useEffect(() => {
    const { table, foreignKey } = messageScope({ type, id });
    const subscription = db
      .channel(`voKalia:${table}:${id}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table, filter: `${foreignKey}=eq.${id}` },
        messages.refresh,
      )
      .subscribe(status => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') messages.refresh();
      });
    window.addEventListener('focus', messages.refresh);
    return () => {
      window.removeEventListener('focus', messages.refresh);
      void db.removeChannel(subscription);
    };
  }, [db, type, id, messages.refresh]);

  useEffect(() => {
    if (connected) return;
    const timer = window.setInterval(messages.refresh, 12_000);
    return () => window.clearInterval(timer);
  }, [connected, messages.refresh]);

  useLayoutEffect(() => {
    if (!feed.current || !messages.data) return;
    if (preservePosition.current !== null) {
      feed.current.scrollTop = feed.current.scrollHeight - preservePosition.current;
      preservePosition.current = null;
    } else if (nearEnd.current) {
      feed.current.scrollTop = feed.current.scrollHeight;
    }
  }, [messages.data]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setFailure('');
    try {
      const { table, foreignKey } = messageScope(target);
      read(await db.from(table).insert({ [foreignKey]: id, body }));
      setDraft('');
      nearEnd.current = true;
      messages.refresh();
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setSending(false);
      composer.current?.focus();
    }
  }

  const Icon = type === 'direct' ? Lock : Hash;
  return (
    <section className="panel conversation" aria-label={title}>
      <header className="conversation-header">
        <span className="section-icon">
          <Icon size={19} aria-hidden />
        </span>
        <div>
          <p className="eyebrow">{type === 'direct' ? 'Conversation privée' : 'Salon textuel'}</p>
          <h2>{title}</h2>
        </div>
      </header>
      <div
        ref={feed}
        className="message-feed"
        onScroll={event => {
          const el = event.currentTarget;
          nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
        }}
      >
        {messages.loading && <Loading text="Ouverture de la conversation…" />}
        <ErrorNotice text={messages.error} />
        {messages.data?.length === limit && limit < 300 && (
          <button
            className="button secondary older"
            onClick={() => {
              if (feed.current) preservePosition.current = feed.current.scrollHeight - feed.current.scrollTop;
              setLimit(value => value + 50);
            }}
          >
            Charger les messages précédents
          </button>
        )}
        {messages.data?.length === 0 && <p className="empty-message">La conversation commence ici.</p>}
        <div
          className="message-items"
          role="log"
          aria-label="Messages"
          aria-live="polite"
          aria-relevant="additions"
        >
          {messages.data?.map(message => {
            const own = message.author_id === self.id;
            const name = message.author?.display_name ?? 'Membre';
            return (
              <article className="message" key={message.id}>
                <Avatar name={name} />
                <div>
                  <div className="message-byline">
                    <strong>
                      {name}
                      {own && <small> · toi</small>}
                    </strong>
                    <time dateTime={message.created_at}>
                      {dateFormat.format(new Date(message.created_at))}
                    </time>
                  </div>
                  <p>{message.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <form className="composer" onSubmit={send}>
        <ErrorNotice text={failure} />
        <div>
          <textarea
            ref={composer}
            rows={2}
            aria-label="Ton message"
            placeholder={`Écrire dans ${title}…`}
            value={draft}
            maxLength={2000}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                matchMedia('(pointer: fine)').matches
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className="button primary send"
            type="submit"
            aria-label="Envoyer"
            disabled={sending || !draft.trim()}
          >
            <Send size={17} aria-hidden />
            <span>Envoyer</span>
          </button>
        </div>
      </form>
    </section>
  );
}
