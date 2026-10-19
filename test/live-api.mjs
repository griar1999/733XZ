// End-to-end checks against a running live server: node test/live-api.mjs [baseUrl] [adminCode]
const BASE = process.argv[2] || 'http://127.0.0.1:8788';
const ADMIN = process.argv[3] || 'PS-TEST-2026-XZ';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
async function req(cookie, path, body, method) {
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data, cookie: sc ? sc.split(';')[0] : null };
}
const login = async (code) => req(null, '/api/login', { code });
const act = (c, name, ...args) => req(c, '/api/action', { name, args });
const at = (days, h) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };

console.log('Sign-in');
ok((await req(null, '/api/state')).status === 401, 'state requires sign-in');
ok((await login('WRONGCODE1')).status === 401, 'wrong code rejected');
const a = await login(ADMIN);
ok(a.status === 200 && a.data.me.role === 'admin' && a.cookie, 'admin code signs in as owner/admin');
const admin = a.cookie;
const st = await req(admin, '/api/state');
ok(st.status === 200 && st.data.state.members.length >= 1 && st.data.state.settings.tailNumber === 'N733XZ', 'state loads with owner + N733XZ, no sample data');

console.log('Members and phones');
const addA = await act(admin, 'addMember', 'Test Pilot A', 'pilot');
const addB = await act(admin, 'addMember', 'Test Pilot B', 'pilot');
ok(addA.status === 200 && addB.status === 200, 'admin adds two members');
const A = addA.data.result.id, B = addB.data.result.id;
ok((await act(admin, 'addMember', 'Test Pilot A', 'pilot')).status === 400, 'duplicate member name rejected');
ok((await req(admin, '/api/admin/phones', { entries: [{ memberId: A, phone: '(661) 555-0101' }, { memberId: B, phone: '661-555-0102' }] })).status === 400, 'bulk phone import rejected');
const ph1 = await req(admin, '/api/admin/phones', { entries: [{ memberId: A, phone: '(661) 555-0101' }] });
const ph2 = await req(admin, '/api/admin/phones', { entries: [{ memberId: B, phone: '661-555-0102' }] });
ok(ph1.status === 200 && ph2.status === 200, 'phones saved one at a time');
ok((await req(admin, '/api/admin/phones', { entries: [{ memberId: B, phone: '6615550101' }] })).status === 400, 'same phone for two members rejected');
const la = await login('6615550101'), lb = await login('6615550102');
ok(la.status === 200 && la.data.me.memberId === A && lb.data.me.memberId === B, 'members sign in by phone number');
const pa = la.cookie, pb = lb.cookie;
ok((await login('6615559999')).status === 401, 'unknown phone rejected');

console.log('Permissions (server-side)');
ok((await act(pa, 'addMember', 'Sneaky', 'admin')).status === 403, 'pilot cannot add members');
ok((await act(pa, 'updateSettings', { rateCentsPerHour: 1 })).status === 403, 'pilot cannot change settings');
ok((await req(pa, '/api/admin/accounts')).status === 403, 'pilot cannot see sign-in admin');
ok((await act(pa, 'createBooking', { pilotId: B, startUtc: at(3, 16), endUtc: at(3, 18), destination: '', notes: '' })).status === 403, 'pilot cannot book for someone else');
ok((await act(pa, 'updateMember', B, { name: 'Renamed B' })).status === 403, 'pilot cannot rename someone else');
ok((await act(pa, 'updateMember', A, { name: 'Test Pilot A2' })).status === 200, 'pilot renames himself');
ok((await act(pa, 'updateMember', A, { role: 'admin' })).status === 403, 'pilot cannot make himself admin');
ok((await act(admin, 'updateMember', A, { name: 'Test Pilot A' })).status === 200, 'admin renames a pilot');
const stP = await req(pa, '/api/state');
ok(stP.data.state.members.every((m) => m.id === A || !m.email), 'pilots do not see other members\' emails');

console.log('Bookings and atomic conflict prevention');
const b1 = await act(pa, 'createBooking', { pilotId: A, startUtc: at(5, 16), endUtc: at(5, 19), destination: 'KSBA', notes: '' });
ok(b1.status === 200 && b1.data.result.status === 'confirmed', 'pilot A books');
const clash = await act(pb, 'createBooking', { pilotId: B, startUtc: at(5, 17), endUtc: at(5, 18), destination: '', notes: '' });
ok(clash.status === 409 && clash.data.code === 'conflict' && clash.data.details.suggestion, 'overlap rejected with suggested slot');
const adj = await act(pb, 'createBooking', { pilotId: B, startUtc: at(5, 19), endUtc: at(5, 20), destination: '', notes: '' });
ok(adj.status === 200, 'adjacent booking allowed (buffer 0)');
// 10 simultaneous requests for the same slot from two members
const slot = { startUtc: at(9, 16), endUtc: at(9, 18), destination: 'race', notes: '' };
const race = await Promise.all(Array.from({ length: 10 }, (_, i) => act(i % 2 ? pb : pa, 'createBooking', { ...slot, pilotId: i % 2 ? B : A })));
const wins = race.filter((r) => r.status === 200).length;
ok(wins === 1, `10 simultaneous requests for one slot → exactly 1 succeeded (got ${wins})`);
const after = await req(admin, '/api/state');
ok(after.data.state.bookings.filter((b) => b.destination === 'race' && b.status === 'confirmed').length === 1, 'database holds exactly one booking for the raced slot');
ok((await act(pb, 'cancelBooking', b1.data.result.id, '')).status === 403, 'pilot B cannot cancel A\'s booking');
const stale = await act(pa, 'updateBooking', b1.data.result.id, { pilotId: A, startUtc: at(5, 15), endUtc: at(5, 19), destination: 'KSBA', notes: '' }, 99);
ok(stale.status === 409 && stale.data.code === 'stale', 'edit from an out-of-date copy rejected');

console.log('Restrictions, issues, photos');
const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const iss = await act(pa, 'reportIssue', { title: 'Oil on cowl', description: 'test', urgency: 'grounding', groundAircraft: true, photoDataUrl: tiny });
ok(iss.status === 200 && iss.data.result.photoDataUrl.startsWith('/api/photo/'), 'issue photo stored separately, document keeps a link');
const photoUrl = iss.data.result.photoDataUrl;
const pr = await fetch(BASE + photoUrl, { headers: { cookie: pa } });
ok(pr.status === 200 && pr.headers.get('content-type') === 'image/png', 'signed-in member can view the photo');
ok((await fetch(BASE + photoUrl)).status === 401, 'photo is not public');
const grounded = await req(admin, '/api/state');
const rid = grounded.data.state.restrictions.find((r) => !r.clearedAt && r.level === 'grounded').id;
ok((await act(pa, 'clearRestriction', rid, 'pilot wants to fly today')).status === 403, 'pilot cannot clear grounding');
ok((await act(admin, 'updateIssue', iss.data.result.id, 'resolved', 'fixed')).status === 200, 'admin resolves issue');
ok((await req(admin, '/api/state')).data.state.restrictions.some((r) => r.id === rid && !r.clearedAt), 'grounding stays after issue resolved');
ok((await act(admin, 'clearRestriction', rid, 'Shop signed off repair, logbook reviewed')).status === 200, 'admin clears grounding with reason');

console.log('Flight record privacy');
const q = (m) => new Date(Math.ceil((Date.now() + m * 60e3) / 900e3) * 900e3).toISOString();
const fb = await act(pa, 'createBooking', { pilotId: A, startUtc: q(15), endUtc: q(75), destination: '', notes: '' });
ok(fb.status === 200, 'pilot A books a flight starting soon');
ok((await act(pa, 'checkOut', fb.data.result.id)).status === 200 && (await act(pa, 'returnAircraft', fb.data.result.id, { note: '', fuelToppedOff: true })).status === 200, 'A checks out and returns');
const fr = await act(pa, 'submitFlight', { bookingId: fb.data.result.id, pilotId: A, flightDate: new Date().toISOString().slice(0, 10), route: 'KBFL secret', hobbsStart: 500000, hobbsEnd: 500150, tachStart: 400000, tachEnd: 400120, fuelGallons: 1200, fuelCostCents: 7200, notes: 'private note', submissionKey: 'priv' + Date.now() });
ok(fr.status === 200, 'A records the flight');
const fid = fr.data.result.record.id;
const sB = (await req(pb, '/api/state')).data.state;
ok(!sB.flights.some((f) => f.id === fid || f.pilotId === A), 'pilot B does not receive A\'s flight record');
ok(!JSON.stringify(sB).includes('KBFL secret') && !JSON.stringify(sB).includes('private note'), 'nothing from A\'s record anywhere in B\'s data (incl. activity)');
const stub = sB.flights.find((f) => f.meterOnly);
ok(stub && stub.hobbsEnd === 500150 && stub.tachEnd === 400120 && stub.pilotId === '', 'B gets only the latest Hobbs/tach, unattributed');
ok(sB.audit.every((a) => a.before === undefined && a.after === undefined), 'activity details stripped for pilots');
const sA = (await req(pa, '/api/state')).data.state;
ok(sA.flights.some((f) => f.id === fid && f.route === 'KBFL secret'), 'pilot A still sees his own record');
ok((await req(admin, '/api/state')).data.state.flights.some((f) => f.id === fid), 'admin sees every record');
ok((await req(pb, '/api/track?flight=' + fid)).status === 404, 'B cannot load A\'s flight path');

console.log('Codes and revocation');
const nc = await req(admin, '/api/admin/code', { memberId: B });
ok(nc.status === 200 && nc.data.code.length === 8, 'admin makes a sign-in code (shown once)');
const lc = await login(nc.data.code);
ok(lc.status === 200 && lc.data.me.memberId === B, 'code signs in');
ok((await req(pb, '/api/state')).status === 401, 'new code signs out B\'s other phones');
const rv = await req(admin, '/api/admin/revoke', { memberId: B });
ok(rv.status === 200 && (await req(lc.cookie, '/api/state')).status === 401 && (await login('6615550102')).status === 401, 'revoke ends sessions, phone and code');
const deact = await act(admin, 'updateMember', A, { active: false });
ok(deact.status === 200 && (await req(pa, '/api/state')).status === 401, 'deactivated member is signed out everywhere');
ok((await act(admin, 'updateMember', 'owner', { role: 'pilot' })).status === 400, 'cannot remove the last admin');

console.log('Security basics');
const xo = await fetch(BASE + '/api/action', { method: 'POST', headers: { 'content-type': 'application/json', cookie: admin, origin: 'https://evil.example' }, body: '{"name":"addMember","args":["x"]}' });
ok(xo.status === 403, 'cross-site POST blocked');
ok((await act(admin, 'noSuchAction')).status === 400, 'unknown action rejected');
const lo = await req(admin, '/api/logout', {});
ok(lo.status === 200 && (await req(admin, '/api/state')).status === 401, 'sign out ends the session');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
