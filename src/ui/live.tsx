// Live site only: sign-in, the loading gate, and the admin's sign-in access screen.
import React, { useCallback, useEffect, useState } from 'react';
import { HttpApi, auth, type AccountRow, type Me } from '../services/httpApi';
import { ApiError } from '../services/api';
import { formatPhone, normalizePhone, parsePhoneList } from '../domain/phones';
import { fmtDateTime } from '../domain/time';
import { AppProvider, useApp, useAction } from './context';
import { App } from './App';
import { Avatar, Banner, Button, Empty, Field, Icon, Pill, Section, Skeleton } from './components';

type AuthState = { status: 'loading' } | { status: 'signedOut'; error?: string } | { status: 'signedIn'; me: Me };

export function LiveRoot({ api }: { api: HttpApi }) {
  const [st, setSt] = useState<AuthState>({ status: 'loading' });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (me: Me) => {
    setSt({ status: 'signedIn', me });
    try { await api.refresh(); setLoaded(true); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'auth') setSt({ status: 'signedOut' });
      else setSt({ status: 'signedOut', error: (e as Error).message });
    }
  }, [api]);

  useEffect(() => {
    (async () => {
      // A sign-in link looks like /?code=XXXXXXXX
      const q = new URLSearchParams(location.search);
      const lc = q.get('code');
      if (lc) {
        history.replaceState(null, '', location.pathname + location.hash);
        try { const r = await auth.login(lc); await load(r.me); } catch (e) { setSt({ status: 'signedOut', error: (e as Error).message }); }
        return;
      }
      try { const r = await auth.me(); await load(r.me); }
      catch (e) {
        if (e instanceof ApiError && e.code === 'offline') {
          // Offline on open: show this phone's last copy, read-only, if there is one.
          try { await api.refresh(); if (api.hasState()) { setSt({ status: 'signedIn', me: cachedMe(api) }); setLoaded(true); return; } } catch { /* nothing cached */ }
          setSt({ status: 'signedOut', error: "You're offline and this phone has no saved copy yet. Connect and sign in." });
          return;
        }
        setSt({ status: 'signedOut', error: e instanceof ApiError && e.code !== 'auth' ? e.message : undefined });
      }
    })();
  }, [api, load]);

  const signOut = useCallback(async () => {
    try { await auth.logout(); } catch { /* ignore */ }
    api.clear();
    try { localStorage.removeItem('planeshare.live.me'); } catch { /* ignore */ }
    setLoaded(false);
    setSt({ status: 'signedOut' });
  }, [api]);

  useEffect(() => {
    if (st.status === 'signedIn') { try { localStorage.setItem('planeshare.live.me', JSON.stringify(st.me)); } catch { /* ignore */ } }
  }, [st]);

  if (st.status === 'loading' || (st.status === 'signedIn' && !loaded)) {
    return <div className="gate"><div className="gate-card"><span className="brand-mark" aria-hidden="true"><Icon name="plane" size={20} /></span><Skeleton lines={3} /></div></div>;
  }
  if (st.status === 'signedOut') {
    return <SignIn error={st.error} onSignedIn={(me) => load(me)} />;
  }
  return <AppProvider api={api} liveMe={st.me} onSignOut={signOut}><App /></AppProvider>;
}

function cachedMe(api: HttpApi): Me {
  try { const raw = localStorage.getItem('planeshare.live.me'); if (raw) return JSON.parse(raw) as Me; } catch { /* ignore */ }
  const m = api.snapshot().members[0];
  return { memberId: m.id, name: m.name, role: m.role, isOwner: false };
}

/** Show (661) 555-1234 as the member types. */
function typingPhone(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
const normCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
const fmtCode = (v: string) => (normCode(v).match(/.{1,4}/g) ?? []).join('-');

function SignIn({ error, onSignedIn }: { error?: string; onSignedIn: (me: Me) => void }) {
  const [mode, setMode] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error);
  const raw = mode === 'phone' ? normalizePhone(phone) ?? '' : normCode(code);
  const ready = mode === 'phone' ? !!normalizePhone(phone) : raw.length >= 8;
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><Icon name="plane" size={20} /></span><span><strong>PlaneShare</strong><span className="brand-tail">Members only</span></span></div>
        <h1>Sign in</h1>
        <p className="fine">{mode === 'phone' ? 'Enter your phone number.' : 'Enter the sign-in code the admin sent you.'}</p>
        {err && <Banner tone="danger" title={err} />}
        <form className="form" onSubmit={async (e) => {
          e.preventDefault();
          if (!ready || busy) return;
          setBusy(true); setErr(undefined);
          try { const r = await auth.login(raw); onSignedIn(r.me); }
          catch (x) { setErr((x as Error).message); }
          finally { setBusy(false); }
        }}>
          {mode === 'phone'
            ? <Field id="si-phone" label="Phone number"><input key="p" className="code-input mono" type="tel" inputMode="tel" autoComplete="tel-national" value={typingPhone(phone)} onChange={(e) => setPhone(e.target.value)} placeholder="(661) 555-1234" autoFocus /></Field>
            : <Field id="si-code" label="Sign-in code"><input key="c" className="code-input mono" value={fmtCode(code)} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={19} autoFocus /></Field>}
          <Button type="submit" variant="primary" size="lg" block pending={busy} disabled={!ready}>Sign in</Button>
        </form>
        <button className="link" onClick={() => { setMode(mode === 'phone' ? 'code' : 'phone'); setErr(undefined); }}>
          {mode === 'phone' ? 'Have a sign-in code instead?' : 'Use your phone number instead'}
        </button>
        <p className="fine">{mode === 'phone' ? 'Number not working? Ask the admin to add it.' : "Don't have a code? Ask the admin."} You stay signed in on this phone until you sign out.</p>
      </div>
    </div>
  );
}

// ---------------- Admin: sign-in access ----------------
export function AccessScreen() {
  const { api, db, me, toast, offline } = useApp();
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [shown, setShown] = useState<{ memberId: string; code: string } | null>(null);
  const [paste, setPaste] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setRows((await auth.accounts()).accounts); setLoadErr(''); } catch (e) { setLoadErr((e as Error).message); }
  }, []);
  useEffect(() => { void reload(); }, [reload, db.members.length]);

  const doIt = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try { await fn(); if (ok) toast(ok); await reload(); return true; }
    catch (e) { toast((e as Error).message, 'error'); return false; }
    finally { setBusy(null); }
  };

  const add = useAction(async () => {
    const phone = newPhone.trim() ? normalizePhone(newPhone) : null;
    if (newPhone.trim() && !phone) throw new ApiError('validation', `"${newPhone}" isn't a 10-digit US phone number.`, { fieldErrors: { phone: 'Use a 10-digit US number.' } });
    const m = await api.addMember(me.id, newName, 'pilot');
    if (phone) await auth.setPhones([{ memberId: m.id, phone }]);
    return m;
  });

  const parsed = paste.trim() ? parsePhoneList(paste, db.members) : [];
  const parsedOk = parsed.filter((p) => p.phone && p.playerId && !p.why);
  const byId = new Map((rows ?? []).map((r) => [r.memberId, r]));
  const origin = typeof location !== 'undefined' ? location.origin : '';

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy blocked. Select the text and copy it.', 'info'); }
  };

  return (
    <>
      <p className="fine">Members sign in with their phone number. A sign-in code is a backup (shown once). Turning sign-in off signs that member out on every phone.</p>
      <Banner tone="info" title="Phone sign-in is convenient, not strong security">Anyone who knows a member's number could sign in as them. Every booking, check-out and flight record shows who did it, and the activity history keeps previous values.</Banner>
      {loadErr && <Banner tone="danger" title={loadErr} />}

      <Section title="Add a member">
        <form className="form subcard" onSubmit={async (e) => { e.preventDefault(); const m = await add.run(); if (m) { toast(`${m.name} added`); setNewName(''); setNewPhone(''); await reload(); } }}>
          <div className="grid2">
            <Field id="ac-name" label="Name" error={add.error?.details.fieldErrors?.name}><input value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="off" /></Field>
            <Field id="ac-phone" label="Phone (for sign-in)" error={add.error?.details.fieldErrors?.phone}><input type="tel" inputMode="tel" value={typingPhone(newPhone)} onChange={(e) => setNewPhone(e.target.value)} placeholder="(661) 555-1234" /></Field>
          </div>
          {add.error && !add.error.details.fieldErrors && <Banner tone="danger" title={add.error.message} />}
          <Button type="submit" variant="primary" pending={add.pending} disabled={offline || !newName.trim()}>Add member</Button>
          <p className="fine">New members are pilots. Make someone an admin in Settings → Members.</p>
        </form>
      </Section>

      {shown && (
        <Banner tone="ok" title={`New code for ${db.members.find((m) => m.id === shown.memberId)?.name}: ${fmtCode(shown.code)}`}>
          <p>Shown once. Send it by text. Sign-in link:</p>
          <p className="mono small" style={{ overflowWrap: 'anywhere' }}>{origin}/?code={shown.code}</p>
          <div className="btn-row"><Button icon="copy" onClick={() => copy(`${origin}/?code=${shown.code}`)}>Copy link</Button><Button variant="ghost" onClick={() => setShown(null)}>Done</Button></div>
        </Banner>
      )}

      <Section title="Members">
        {!rows && !loadErr && <Skeleton lines={4} />}
        {rows && (
          <div className="stack">
            {db.members.map((m) => {
              const r = byId.get(m.id);
              return (
                <div key={m.id} className="access-row">
                  <Avatar m={m} />
                  <div className="access-main">
                    <p><strong>{m.name}</strong> {m.role === 'admin' && <Pill tone="info">Admin</Pill>} {!m.active && <Pill tone="muted">Inactive</Pill>}</p>
                    <p className="fine">{r?.phone ? formatPhone(r.phone) : 'No phone'} · {r?.hasCode ? 'Has code' : 'No code'} · {r?.lastLogin ? `Last sign-in ${fmtDateTime(r.lastLogin, db.settings.timeZone)}` : 'Never signed in'}</p>
                  </div>
                  <div className="btn-row">
                    <PhoneEdit memberId={m.id} current={r?.phone ?? null} busy={busy} onSave={(phone) => doIt('phone' + m.id, () => auth.setPhones([{ memberId: m.id, phone }]), phone ? 'Phone saved' : 'Phone removed')} />
                    <Button disabled={offline || !!busy} pending={busy === 'code' + m.id} onClick={() => doIt('code' + m.id, async () => setShown(await auth.newCode(m.id)))}>New code</Button>
                    {m.id !== me.id && (confirmRevoke === m.id
                      ? <><Button variant="danger" pending={busy === 'rev' + m.id} onClick={() => doIt('rev' + m.id, () => auth.revoke(m.id), `${m.name} signed out everywhere`).then(() => setConfirmRevoke(null))}>Turn off sign-in</Button><Button variant="ghost" onClick={() => setConfirmRevoke(null)}>Keep</Button></>
                      : <Button variant="ghost" disabled={offline} onClick={() => setConfirmRevoke(m.id)}>Turn off…</Button>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {rows && db.members.length < 2 && <Empty title="Only you so far">Add the other five members above.</Empty>}
      </Section>

      <Section title="Paste a list of phone numbers">
        <Field id="ac-paste" label="One member per line: Name, phone" hint="Works with a list copied from Contacts, a text, or Excel. Names must match existing members.">
          <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Jane Smith, (661) 555-0101\nJohn Lee, 661-555-0102'} />
        </Field>
        {parsed.length > 0 && (
          <ul className="plain">{parsed.map((p, i) => (
            <li key={i}><Pill tone={p.why ? 'warn' : 'ok'}>{p.why ? 'Check' : 'OK'}</Pill> {p.name || '(no name)'} → {p.phone ? formatPhone(p.phone) : '—'} {p.playerId && `= ${db.members.find((m) => m.id === p.playerId)?.name}`} {p.why && <span className="fine">· {p.why}</span>}</li>
          ))}</ul>
        )}
        {parsed.length > 0 && <Button variant="primary" disabled={!parsedOk.length || offline} pending={busy === 'paste'} onClick={() => doIt('paste', () => auth.setPhones(parsedOk.map((p) => ({ memberId: p.playerId!, phone: p.phone }))), `${parsedOk.length} phone number${parsedOk.length > 1 ? 's' : ''} saved`).then((ok) => { if (ok) setPaste(''); })}>Save {parsedOk.length} number{parsedOk.length === 1 ? '' : 's'}</Button>}
      </Section>
    </>
  );
}

function PhoneEdit({ memberId, current, busy, onSave }: { memberId: string; current: string | null; busy: string | null; onSave: (phone: string | null) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(current ? formatPhone(current) : '');
  const ok = !v.trim() || !!normalizePhone(v);
  if (!open) return <Button disabled={!!busy} onClick={() => { setV(current ? formatPhone(current) : ''); setOpen(true); }}>{current ? 'Change phone' : 'Add phone'}</Button>;
  return (
    <form className="inline-edit" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; if (await onSave(v.trim() ? normalizePhone(v) : null)) setOpen(false); }}>
      <input aria-label="Phone number" type="tel" inputMode="tel" value={typingPhone(v)} onChange={(e) => setV(e.target.value)} placeholder="(661) 555-1234" autoFocus aria-invalid={!ok || undefined} />
      <Button type="submit" variant="primary" disabled={!ok} pending={busy === 'phone' + memberId}>Save</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

export function AccountCard() {
  const { me, signOut, db } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Your account">
      <div className="access-row">
        <Avatar m={me} />
        <div className="access-main"><p><strong>{me.name}</strong></p><p className="fine">{me.role === 'admin' ? 'Admin + pilot' : 'Pilot'} · {db.settings.appName}</p></div>
        <Button pending={busy} onClick={async () => { setBusy(true); await signOut(); }}>Sign out</Button>
      </div>
    </Section>
  );
}
