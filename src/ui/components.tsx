import React, { useEffect, useId, useRef } from 'react';
import type { Booking, Member } from '../domain/types';
import { statusLabel } from '../domain/rules';

const paths: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.8V20h13V9.8',
  calendar: 'M4 6.5h16V20H4zM4 10.5h16M8 3.5v5M16 3.5v5',
  bookings: 'M6 4h12v16l-6-3.5L6 20z',
  log: 'M5 4h11l3 3v13H5zM9 10h6M9 14h6M9 18h3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  key: 'M14.5 9.5a4 4 0 1 1-1.2-2.8M13.5 10.5 20 17v3h-3v-2h-2v-2h-2',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2h.01',
  wrench: 'M14.5 6.5a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.5-6.5a4 4 0 0 1-2-2z',
  check: 'M5 12.5 10 17 19 7',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4.5l3 2',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7.4 7.4 0 0 1-2 1.2l-.3 2H11l-.3-2a7.4 7.4 0 0 1-2-1.2l-1.9.7L5 14.7l1.6-1.2a7.6 7.6 0 0 1 0-3L5 9.3l1.8-3.1 1.9.7a7.4 7.4 0 0 1 2-1.2l.3-2h3.6l.3 2a7.4 7.4 0 0 1 2 1.2l1.9-.7L21 9.3l-1.6 1.2a7.6 7.6 0 0 1 0 3z',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  flask: 'M9 3h6M10 3v6L5 19a1.3 1.3 0 0 0 1.2 2h11.6A1.3 1.3 0 0 0 19 19l-5-10V3',
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5A3.8 3.8 0 0 1 17.5 18z',
  plane: 'M21 15.5v-2l-8-5V4a1.5 1.5 0 0 0-3 0v4.5l-8 5v2l8-2.5V18l-2.5 1.8V21l4-1 4 1v-1.2L13 18v-5z',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  camera: 'M4 8h3.5L9 5.5h6L16.5 8H20v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  receipt: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  print: 'M7 9V4h10v5M7 17H5V10h14v7h-2M7 14h10v6H7z',
};

export function Icon({ name, size = 22, label }: { name: keyof typeof paths | string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; pending?: boolean; icon?: string; block?: boolean; size?: 'md' | 'lg' };
export function Button({ variant = 'secondary', pending, icon, block, size = 'md', children, disabled, className = '', ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || pending} aria-busy={pending || undefined} className={`btn btn-${variant} btn-${size} ${block ? 'btn-block' : ''} ${className}`}>
      {pending ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={20} /> : null}
      <span>{children}</span>
    </button>
  );
}

/** A button that stays focusable when unavailable and explains why. */
export function GatedButton({ reason, onClick, ...rest }: BtnProps & { reason: string | null }) {
  const id = useId();
  return (
    <div className="gated">
      <Button {...rest} aria-disabled={!!reason || undefined} aria-describedby={reason ? id : undefined}
        className={`${rest.className ?? ''} ${reason ? 'is-unavailable' : ''}`}
        onClick={(e) => { if (reason) { e.preventDefault(); (document.getElementById(id) as HTMLElement | null)?.animate?.([{ opacity: .4 }, { opacity: 1 }], 400); return; } onClick?.(e); }} />
      {reason && <p className="gated-reason" id={id}>{reason}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-x)');
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="modal-x icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, error, hint, children, id }: { label: string; error?: string; hint?: React.ReactNode; children: React.ReactElement; id: string }) {
  const errId = id + '-err', hintId = id + '-hint';
  const child = React.cloneElement(children, {
    id, 'aria-invalid': error ? true : undefined,
    'aria-describedby': [error ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined,
  });
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {child}
      {hint && !error && <p className="hint" id={hintId}>{hint}</p>}
      {error && <p className="field-error" id={errId} role="alert"><Icon name="alert" size={16} /> {error}</p>}
    </div>
  );
}

export function StatusPill({ status }: { status: Booking['status'] }) {
  return <span className={`pill pill-${status}`}>{statusLabel(status)}</span>;
}
export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted'; children: React.ReactNode }) {
  return <span className={`pill pill-tone-${tone}`}>{children}</span>;
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty"><p className="empty-title">{title}</p>{children && <p>{children}</p>}{action}</div>;
}

export function Banner({ tone, title, children, icon }: { tone: 'warn' | 'danger' | 'info' | 'ok'; title: string; children?: React.ReactNode; icon?: string }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon ?? (tone === 'ok' ? 'check' : 'alert')} size={20} />
      <div><p className="banner-title">{title}</p>{children && <div className="banner-body">{children}</div>}</div>
    </div>
  );
}

export function Avatar({ m, size = 32 }: { m?: Member; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{m?.initials ?? '?'}</span>;
}

export function Section({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`section ${className}`}>
      <div className="section-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value);
            if (e.key === 'ArrowRight') { e.preventDefault(); onChange(options[(i + 1) % options.length].value); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value); }
          }}>{o.label}</button>
      ))}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${90 - i * 15}%` }} />)}</div>;
}

/** Cessna 172 side view (high wing, strut, swept tail, fixed gear). Filled, takes the text color. */
export function PlaneIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 240 / 452)} viewBox="28 128 452 240" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M58 246 L66 234 L196 204 L334 204 L376 226 L420 230 C436 233 444 242 444 252 C444 264 436 272 420 274 L340 292 L204 296 L88 268 Z M206 214 L262 212 L262 244 L210 246 Z M272 212 L332 212 L360 232 L272 238 Z M166 226 L198 214 L198 246 L170 248 Z" />
      <path d="M444 238 C460 241 466 247 466 253 C466 259 460 265 444 268 Z M182 198 L318 184 C338 182 350 186 352 194 C353 201 344 206 330 206 L188 206 C180 206 178 200 182 198 Z M72 244 L54 150 C53 143 57 139 64 139 L92 139 C100 139 104 144 108 151 L162 222 Z M36 245 C36 239 42 237 52 237 L132 239 L132 252 L52 254 C42 254 36 251 36 245 Z" />
      <rect x="463" y="170" width="10" height="168" rx="5" />
      <path d="M286 290 L250 208 M296 292 L318 344 M410 276 L410 342" stroke="currentColor" strokeWidth="12" strokeLinecap="round" fill="none" />
      <circle cx="320" cy="354" r="20" /><circle cx="410" cy="352" r="17" />
    </svg>
  );
}
