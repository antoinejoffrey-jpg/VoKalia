import { useEffect, useRef, type ReactNode } from 'react';
import { AudioLines, LoaderCircle, X } from 'lucide-react';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <AudioLines size={21} aria-hidden />
      </span>
      VoKalia
    </span>
  );
}

// The initials fallback is adapted from the Buildra export.
export function Avatar({ name, size = 'small' }: { name: string; size?: 'small' | 'large' }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => Array.from(part)[0])
    .join('')
    .toUpperCase();
  const tones = ['indigo', 'rose', 'mint', 'amber'];
  const tone =
    tones[Array.from(name).reduce((total, char) => total + (char.codePointAt(0) ?? 0), 0) % tones.length];
  return (
    <span className={`avatar ${size} ${tone}`} aria-hidden>
      {initials || '?'}
    </span>
  );
}

export function ErrorNotice({ text }: { text: string }) {
  return text ? (
    <p className="notice error" role="alert">
      {text}
    </p>
  ) : null;
}

export function Loading({ text = 'Chargement…' }: { text?: string }) {
  return (
    <p className="loading" role="status">
      <LoaderCircle aria-hidden size={17} />
      {text}
    </p>
  );
}

export function Modal({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={title}
      onCancel={event => {
        event.preventDefault();
        if (!busy) close();
      }}
      onClick={event => {
        if (event.target === dialog.current && !busy) close();
      }}
    >
      <div className="modal-inner">
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Fermer" disabled={busy} onClick={close}>
            <X size={19} aria-hidden />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
