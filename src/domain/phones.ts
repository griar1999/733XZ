// Phone-number sign-in helpers, shared by the app and the server.

/** US numbers only: returns the 10 digits, or null. Accepts (661) 555-1234, 661.555.1234, +1 661 555 1234. */
export function normalizePhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10 || ten[0] === '0' || ten[0] === '1') return null;
  return ten;
}

export function formatPhone(p: string | null | undefined): string {
  const t = normalizePhone(p);
  return t ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : '';
}

export interface PhoneLine { line: string; name: string; phone: string | null; playerId: string | null; why?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/**
 * Read a pasted list (one member per line: "Name, phone" — from a text, Excel or Google Sheets),
 * and match each name to a member. Unclear names are left for the admin to pick.
 */
export function parsePhoneList(text: string, players: Array<{ id: string; name: string }>): PhoneLine[] {
  const roster = players.map((p) => ({ id: p.id, n: norm(p.name) }));
  const out: PhoneLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(PHONE_RE);
    const phone = m ? normalizePhone(m[0]) : null;
    const name = (m ? line.replace(m[0], ' ') : line).replace(/[,\t;|]+/g, ' ').replace(/\b(team\s*)?#?\d{1,2}\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const n = norm(name);
    if (!phone && /^(name|player)\b/i.test(n)) continue; // header row
    let hit = roster.filter((r) => r.n === n);
    if (hit.length !== 1) hit = roster.filter((r) => n && (r.n.startsWith(n + ' ') || n.startsWith(r.n + ' ')));
    if (hit.length !== 1) hit = roster.filter((r) => n && r.n.split(' ')[0] === n.split(' ')[0]);
    const playerId = hit.length === 1 ? hit[0].id : null;
    out.push({
      line, name, phone, playerId,
      why: !phone ? 'No phone number found' : !playerId ? (hit.length > 1 ? 'More than one player matches — pick one' : 'Name not found — pick the player') : undefined,
    });
  }
  // the same number twice can't sign in as two people
  const seen = new Map<string, number>();
  out.forEach((r, i) => {
    if (!r.phone) return;
    if (seen.has(r.phone)) { r.why = 'Same number as another line'; out[seen.get(r.phone)!].why ??= 'Same number as another line'; }
    else seen.set(r.phone, i);
  });
  return out;
}
