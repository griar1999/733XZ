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
