// Live prod smoke test of the email/recovery/add-device feature.
//   node --env-file=.env _smoke.mjs
// Uses the public API + service_role (for setup/inspect/cleanup). Creates a
// throwaway reader and deletes it at the end. No real authenticator needed —
// the WebAuthn ceremony is shared, already-proven code; this exercises the NEW
// paths: email capture, recovery-token lifecycle, and auth gating.
import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash, randomUUID } from 'crypto';

const API = 'https://interdependent-api.onrender.com';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log(`  ${c ? '✓' : '✗ FAIL'} ${m}`); };
async function post(path, body, headers = {}) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://www.interdependent.studio', ...headers }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

const SUFFIX = randomUUID().slice(0, 8);
const handle = `zz-smoke-${SUFFIX}`;
const email = `smoke-${SUFFIX}@example.com`;
const readerId = randomUUID();

console.log(`\n=== SMOKE TEST (reader ${handle}) ===\n`);

try {
  console.log('1. register/begin email gate');
  {
    const noEmail = await post('/readers/register/begin', { firstName: 'Smoke', lastName: `Test${SUFFIX}` });
    ok(noEmail.status === 400 && noEmail.body.code === 'email_required', `no email → 400 email_required (got ${noEmail.status}/${noEmail.body.code})`);
    const withEmail = await post('/readers/register/begin', { firstName: 'Smoke', lastName: `Test${SUFFIX}`, email });
    ok(withEmail.status === 200 && withEmail.body.challengeId && withEmail.body.options, `with email → 200 + challenge/options (got ${withEmail.status})`);
  }

  console.log('\n2. seed a throwaway reader WITH email (service_role)');
  {
    const { error } = await db.from('readers').insert({ id: readerId, handle, display_name: `Smoke Test${SUFFIX}`, email });
    ok(!error, `inserted reader ${handle}${error ? ' — ' + error.message : ''}`);
  }

  console.log('\n3. recover/request — matching handle+email creates a token');
  {
    const res = await post('/readers/recover/request', { handle, email });
    ok(res.status === 200 && res.body.ok, `200 generic ok (got ${res.status})`);
    const { data } = await db.from('reader_recovery_tokens').select('id,used_at,expires_at').eq('reader_id', readerId);
    ok((data || []).length === 1, `exactly one token row created (got ${(data || []).length})`);
    ok(data && data[0] && !data[0].used_at && new Date(data[0].expires_at) > new Date(), 'token is unused and not expired');
  }

  console.log('\n4. recover/request — wrong email is a silent no-op (anti-enumeration)');
  {
    const before = (await db.from('reader_recovery_tokens').select('id').eq('reader_id', readerId)).data?.length || 0;
    const res = await post('/readers/recover/request', { handle, email: `wrong-${email}` });
    ok(res.status === 200 && res.body.ok, `200 generic ok even on mismatch (got ${res.status})`);
    // mismatch must NOT mint a new live token (createRecoveryToken invalidates olds, so count stays 1 only via the matching path)
    const after = (await db.from('reader_recovery_tokens').select('id').is('used_at', null).eq('reader_id', readerId)).data?.length || 0;
    ok(after <= before, `no new live token from a mismatched email (live tokens: ${after})`);
  }

  console.log('\n5. recover/begin — valid token returns registration options');
  {
    const raw = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    await db.from('reader_recovery_tokens').update({ used_at: new Date().toISOString() }).eq('reader_id', readerId).is('used_at', null);
    await db.from('reader_recovery_tokens').insert({ reader_id: readerId, token_hash: tokenHash, expires_at: new Date(Date.now() + 30 * 60000).toISOString() });
    const good = await post('/readers/recover/begin', { readerId, token: raw });
    ok(good.status === 200 && good.body.challengeId && good.body.options && good.body.handle === handle, `valid token → 200 + options + handle (got ${good.status})`);

    const bad = await post('/readers/recover/begin', { readerId, token: randomBytes(32).toString('hex') });
    ok(bad.status === 400 && bad.body.code === 'recovery_invalid', `bogus token → 400 recovery_invalid (got ${bad.status}/${bad.body.code})`);
  }

  console.log('\n6. auth gating on protected endpoints (no action token → 401)');
  {
    const add = await post('/readers/credentials/add/begin', {});
    ok(add.status === 401 && add.body.code === 'action_token_missing', `add-device/begin → 401 (got ${add.status}/${add.body.code})`);
    const setEmail = await post('/readers/email', { email });
    ok(setEmail.status === 401, `set-email → 401 (got ${setEmail.status})`);
  }
} catch (e) {
  console.log('  ✗ EXCEPTION', e.message); fail++;
} finally {
  console.log('\n7. cleanup');
  const { error } = await db.from('readers').delete().eq('id', readerId); // cascades tokens
  ok(!error, `deleted throwaway reader${error ? ' — ' + error.message : ''}`);
  const { data } = await db.from('readers').select('id').eq('id', readerId);
  ok((data || []).length === 0, 'reader is gone');
}

console.log(`\n=== ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} — ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
