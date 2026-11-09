import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import type { Room } from 'livekit-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorText, read, voiceEnabled, type Channel } from './data';
import { Avatar, ErrorNotice } from './ui';

type Listener = { id: string; name: string; self: boolean };
type VoiceState = {
  channel: Channel;
  phase: 'joining' | 'live' | 'reconnecting';
  listeners: Listener[];
  muted: boolean;
  needsPlayback: boolean;
};

export function useVoice(db: SupabaseClient) {
  const [state, setState] = useState<VoiceState | null>(null);
  const [error, setError] = useState('');
  const room = useRef<Room | null>(null);
  const generation = useRef(0);
  const joining = useRef(false);

  const disconnect = useCallback(async () => {
    generation.current += 1;
    joining.current = false;
    const active = room.current;
    room.current = null;
    await active?.disconnect();
  }, []);

  useEffect(
    () => () => {
      void disconnect();
    },
    [disconnect],
  );

  async function leave() {
    setState(null);
    setError('');
    await disconnect();
  }

  async function join(channel: Channel) {
    if (!voiceEnabled || joining.current || state?.channel.id === channel.id) return;
    joining.current = true;
    const attempt = ++generation.current;
    setError('');
    const previous = room.current;
    room.current = null;
    setState({ channel, phase: 'joining', listeners: [], muted: true, needsPlayback: false });
    try {
      await previous?.disconnect();
      const [{ Room: LiveRoom, RoomEvent, Track }, credentials] = await Promise.all([
        import('livekit-client'),
        db.functions.invoke<{ url: string; token: string }>('voice-token', {
          body: { channelId: channel.id },
        }),
      ]);
      if (generation.current !== attempt) return;
      const { url, token } = read(credentials);
      const connection = new LiveRoom();
      room.current = connection;
      const audioElements = new Set<HTMLMediaElement>();
      const removeAudio = () => {
        audioElements.forEach(element => element.remove());
        audioElements.clear();
      };
      const syncListeners = () => {
        if (room.current !== connection) return;
        const users = [connection.localParticipant, ...connection.remoteParticipants.values()];
        setState(current =>
          current
            ? {
                ...current,
                listeners: users.map(user => ({
                  id: user.identity,
                  name: user.name || 'Membre',
                  self: user === connection.localParticipant,
                })),
              }
            : current,
        );
      };
      const phase = (value: VoiceState['phase']) => {
        if (room.current === connection)
          setState(current => (current ? { ...current, phase: value } : current));
      };
      connection.on(RoomEvent.TrackSubscribed, track => {
        if (track.kind !== Track.Kind.Audio || room.current !== connection) return;
        const element = track.attach();
        element.hidden = true;
        audioElements.add(element);
        document.body.append(element);
      });
      connection.on(RoomEvent.TrackUnsubscribed, track =>
        track.detach().forEach(element => {
          audioElements.delete(element);
          element.remove();
        }),
      );
      connection.on(RoomEvent.ParticipantConnected, syncListeners);
      connection.on(RoomEvent.ParticipantDisconnected, syncListeners);
      connection.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (room.current === connection) {
          setState(current =>
            current ? { ...current, needsPlayback: !connection.canPlaybackAudio } : current,
          );
        }
      });
      connection.on(RoomEvent.Reconnecting, () => phase('reconnecting'));
      connection.on(RoomEvent.Reconnected, () => {
        phase('live');
        syncListeners();
      });
      connection.on(RoomEvent.Disconnected, () => {
        removeAudio();
        if (room.current === connection) {
          room.current = null;
          setState(null);
        }
      });
      await connection.connect(url, token);
      if (generation.current !== attempt) {
        await connection.disconnect();
        return;
      }
      phase('live');
      syncListeners();
      await connection.startAudio().catch(() => {
        if (room.current === connection)
          setState(current => (current ? { ...current, needsPlayback: true } : current));
      });
    } catch (failure) {
      if (generation.current === attempt) {
        await disconnect();
        setState(null);
        setError(errorText(failure));
      }
    } finally {
      if (generation.current === attempt) joining.current = false;
    }
  }

  async function toggleMicrophone() {
    const active = room.current;
    if (!active) return;
    setError('');
    try {
      await active.localParticipant.setMicrophoneEnabled(!active.localParticipant.isMicrophoneEnabled);
      if (room.current === active)
        setState(current =>
          current ? { ...current, muted: !active.localParticipant.isMicrophoneEnabled } : current,
        );
    } catch {
      setError('Le micro est indisponible. Vérifie son autorisation dans ton navigateur.');
    }
  }

  async function enablePlayback() {
    const active = room.current;
    if (!active) return;
    try {
      await active.startAudio();
      if (room.current === active)
        setState(current => (current ? { ...current, needsPlayback: false } : current));
    } catch {
      setError('Le navigateur bloque encore la lecture audio.');
    }
  }

  return { state, error, join, leave, toggleMicrophone, enablePlayback };
}

export function VoicePanel({ channel, voice }: { channel: Channel; voice: ReturnType<typeof useVoice> }) {
  const current = voice.state?.channel.id === channel.id ? voice.state : null;
  return (
    <section className="panel voice-panel">
      <header className="conversation-header">
        <span className="section-icon">
          <Headphones size={20} aria-hidden />
        </span>
        <div>
          <p className="eyebrow">Salon vocal</p>
          <h2>{channel.name}</h2>
        </div>
      </header>
      <div className="voice-stage">
        {current?.listeners.length ? (
          <div className="voice-listeners">
            {current.listeners.map(person => (
              <div key={person.id}>
                <Avatar name={person.name} size="large" />
                <strong>
                  {person.name}
                  {person.self ? ' · toi' : ''}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="voice-empty">
            <Headphones size={36} aria-hidden />
            <h3>{current?.phase === 'joining' ? 'Connexion au salon…' : 'Rejoins la conversation'}</h3>
            <p>
              {voiceEnabled
                ? 'Tu entres avec ton micro coupé.'
                : 'Le vocal sera disponible après la configuration du service audio.'}
            </p>
          </div>
        )}
        {current?.phase === 'reconnecting' && (
          <p role="status" className="notice">
            Reconnexion au salon…
          </p>
        )}
        <ErrorNotice text={voice.error} />
        <div className="voice-actions">
          {!current && voiceEnabled && (
            <button className="button primary" type="button" onClick={() => void voice.join(channel)}>
              <Headphones size={17} aria-hidden />
              Rejoindre
            </button>
          )}
          {current?.phase === 'live' && (
            <button
              className="button secondary"
              type="button"
              aria-pressed={!current.muted}
              onClick={() => void voice.toggleMicrophone()}
            >
              {current.muted ? <MicOff size={17} aria-hidden /> : <Mic size={17} aria-hidden />}
              {current.muted ? 'Activer le micro' : 'Couper le micro'}
            </button>
          )}
          {current?.needsPlayback && (
            <button className="button secondary" type="button" onClick={() => void voice.enablePlayback()}>
              <Volume2 size={17} aria-hidden />
              Activer le son
            </button>
          )}
          {current && (
            <button className="button danger" type="button" onClick={() => void voice.leave()}>
              <PhoneOff size={17} aria-hidden />
              Quitter
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
