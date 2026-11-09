import { useEffect, useState, type FormEvent } from 'react';
import { Globe2, ImagePlus, Lock, Plus } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServer, errorText, parseTags, prepareBanner, read, type Category, type Server } from './data';
import { ErrorNotice, Modal } from './ui';

export function CreateServerForm({
  db,
  userId,
  close,
  created,
}: {
  db: SupabaseClient;
  userId: string;
  close: () => void;
  created: (serverId: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [crop, setCrop] = useState<'top' | 'center' | 'bottom'>('center');
  const [visibility, setVisibility] = useState<Server['visibility']>('private');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const image = file ? await prepareBanner(file, crop) : null;
      const server = await createServer(
        db,
        userId,
        {
          name: String(fields.get('name')).trim(),
          description: String(fields.get('description')).trim(),
          visibility,
          tags: parseTags(String(fields.get('tags'))),
        },
        image,
      );
      created(server);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Créer un serveur" close={close} busy={busy}>
      <form className="stack" onSubmit={submit}>
        <label>
          Nom du serveur
          <input name="name" placeholder="Le nom qui vous rassemble" minLength={2} maxLength={60} required />
        </label>
        <label>
          Présentation <span className="muted">facultatif</span>
          <textarea name="description" rows={2} maxLength={240} placeholder="Qu’allez-vous partager ici ?" />
        </label>
        <label>
          Mots-clés <span className="muted">facultatif</span>
          <input name="tags" maxLength={240} placeholder="Cinéma, musique, gaming…" />
        </label>
        <div className="banner-field">
          <div className="banner-preview">
            {preview ? (
              <img alt="Aperçu de la bannière" src={preview} style={{ objectPosition: crop }} />
            ) : (
              <span>
                <ImagePlus size={23} aria-hidden />
                Une bannière pour ton univers
              </span>
            )}
          </div>
          <label>
            Image de bannière <span className="muted">facultatif</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={event => {
                const chosen = event.target.files?.[0] ?? null;
                if (
                  chosen &&
                  (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type) ||
                    chosen.size > 12 * 1024 * 1024)
                ) {
                  event.target.value = '';
                  setFile(null);
                  setError('Choisis une image JPG, PNG ou WebP de moins de 12 Mo.');
                  return;
                }
                setError('');
                setFile(chosen);
              }}
            />
          </label>
          {file && (
            <label>
              Cadrage
              <select value={crop} onChange={event => setCrop(event.target.value as typeof crop)}>
                <option value="center">Centré</option>
                <option value="top">Vers le haut</option>
                <option value="bottom">Vers le bas</option>
              </select>
            </label>
          )}
        </div>
        <fieldset className="choice-row">
          <legend>Visibilité</legend>
          <label className={visibility === 'private' ? 'selected' : ''}>
            <input
              type="radio"
              name="visibility"
              checked={visibility === 'private'}
              onChange={() => setVisibility('private')}
            />
            <Lock size={16} aria-hidden />
            Sur invitation
          </label>
          <label className={visibility === 'public' ? 'selected' : ''}>
            <input
              type="radio"
              name="visibility"
              checked={visibility === 'public'}
              onChange={() => setVisibility('public')}
            />
            <Globe2 size={16} aria-hidden />
            Dans Explorer
          </label>
        </fieldset>
        <p className="muted small-text">
          Une catégorie Général, un salon Discussion et un salon vocal Le café seront prêts dès la création.
        </p>
        <ErrorNotice text={error} />
        <button className="button primary" disabled={busy} type="submit">
          <Plus size={17} aria-hidden />
          {busy ? 'Création…' : 'Créer le serveur'}
        </button>
      </form>
    </Modal>
  );
}

export function CreateSpaceForm({
  db,
  serverId,
  categories,
  categoryId,
  mode,
  close,
  saved,
}: {
  db: SupabaseClient;
  serverId: string;
  categories: Category[];
  categoryId?: string;
  mode: 'category' | 'channel';
  close: () => void;
  saved: (channelId?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get('name')).trim();
    setBusy(true);
    setError('');
    try {
      if (mode === 'category') {
        const position = Math.max(-1, ...categories.map(category => category.position)) + 1;
        read(await db.from('vk_categories').insert({ server_id: serverId, name, position }));
        saved();
      } else {
        const row = read<{ id: string }>(
          await db
            .from('vk_channels')
            .insert({
              server_id: serverId,
              category_id: fields.get('category'),
              name,
              kind: fields.get('kind'),
              tags: parseTags(String(fields.get('tags') ?? '')),
            })
            .select('id')
            .single(),
        );
        saved(row.id);
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === 'category' ? 'Nouvelle catégorie' : 'Nouveau salon'} close={close} busy={busy}>
      <form className="stack" onSubmit={submit}>
        <label>
          Nom
          <input
            name="name"
            minLength={2}
            maxLength={50}
            required
            placeholder={mode === 'category' ? 'Ex. Cinéma' : 'Ex. Les sorties du mois'}
          />
        </label>
        {mode === 'channel' && (
          <>
            <label>
              Catégorie
              <select name="category" defaultValue={categoryId} required>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select name="kind">
                <option value="text">Textuel</option>
                <option value="voice">Vocal</option>
              </select>
            </label>
            <label>
              Mots-clés <span className="muted">facultatif</span>
              <input name="tags" maxLength={240} placeholder="Film, critiques, sorties…" />
            </label>
          </>
        )}
        <ErrorNotice text={error} />
        <button
          className="button primary"
          disabled={busy || (mode === 'channel' && !categories.length)}
          type="submit"
        >
          {busy ? 'Création…' : 'Créer'}
        </button>
      </form>
    </Modal>
  );
}
