import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorText, read, type Member } from './data';

export function useResource<T>(load: (() => Promise<T>) | null) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  const [state, setState] = useState<{ load: typeof load; data: T | null; error: string }>({
    load: null,
    data: null,
    error: '',
  });

  useEffect(() => {
    if (!load) return;
    let current = true;
    load()
      .then(data => {
        if (current) setState({ load, data, error: '' });
      })
      .catch(error => {
        if (current)
          setState(previous => ({
            load,
            data: previous.load === load ? previous.data : null,
            error: errorText(error),
          }));
      });
    return () => {
      current = false;
    };
  }, [load, version]);

  return {
    data: state.load === load ? state.data : null,
    error: state.load === load ? state.error : '',
    loading: Boolean(load) && state.load !== load,
    refresh,
  };
}

export function usePresence(db: SupabaseClient, userId: string) {
  const [connection] = useState(() => crypto.randomUUID());
  const stopping = useRef(false);
  const stop = useCallback(async () => {
    stopping.current = true;
    await db.rpc('vk_end_connection', { p_connection: connection });
  }, [db, connection]);

  useEffect(() => {
    stopping.current = false;
    function heartbeat() {
      if (!stopping.current && navigator.onLine) {
        void db.rpc('vk_touch_connection', { p_connection: connection }).then(
          () => undefined,
          () => undefined,
        );
      }
    }
    heartbeat();
    const timer = window.setInterval(heartbeat, 20_000);
    window.addEventListener('focus', heartbeat);
    window.addEventListener('online', heartbeat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', heartbeat);
      window.removeEventListener('online', heartbeat);
    };
  }, [db, userId, connection]);

  return stop;
}

export function useOnlineMembers(db: SupabaseClient, serverId: string | undefined) {
  const load = useCallback(async () => {
    if (!serverId) return [];
    return read<Member[]>(await db.rpc('vk_online_members', { p_server: serverId }));
  }, [db, serverId]);
  const result = useResource(serverId ? load : null);
  useEffect(() => {
    if (!serverId) return;
    const timer = window.setInterval(result.refresh, 10_000);
    return () => window.clearInterval(timer);
  }, [serverId, result.refresh]);
  return result;
}
