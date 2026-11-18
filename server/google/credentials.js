// OAuth client credentials the head coach saves in the app (Google, Clever), per program. Secrets are
// encrypted with the same AES-256-GCM vault as Google tokens and never leave the server.
// Also the short-lived tables for sign-in state and desktop hand-offs.
export const TABLES = `
CREATE TABLE IF NOT EXISTS integration_credentials (
  program_id INTEGER NOT NULL, provider TEXT NOT NULL, client_id TEXT, client_secret_enc TEXT,
  options TEXT DEFAULT '{}', updated_at TEXT, updated_by INTEGER, PRIMARY KEY (program_id, provider)
);
CREATE TABLE IF NOT EXISTS sso_states (
  state TEXT PRIMARY KEY, provider TEXT NOT NULL, program_id INTEGER, nonce TEXT, browser_hash TEXT,
  handoff_hash TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_handoffs (
  handoff_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, provider TEXT NOT NULL, state TEXT, user_id INTEGER,
  status TEXT DEFAULT 'pending', message TEXT, code TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS google_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, disabled TEXT DEFAULT '[]', wanted TEXT DEFAULT '[]',
  name TEXT, picture TEXT
);
`;

export const PROVIDERS = ['google', 'clever'];

export function createCredentials(db, vault) {
  db.exec(TABLES);
  const row = (programId, provider) => (programId ? db.get('SELECT * FROM integration_credentials WHERE program_id=? AND provider=?', programId, provider) : null);
  const opts = (r) => { try { return JSON.parse(r?.options || '{}'); } catch { return {}; } };
  function secretOf(r) {
    if (!r?.client_secret_enc) return null;
    try { return vault.decrypt(r.client_secret_enc); } catch { return null; } // TOKEN_KEY changed: treat as not set
  }
  return {
    // For use on the server only: includes the decrypted secret.
    get(programId, provider) {
      const r = row(programId, provider);
      if (!r) return null;
      return { client_id: r.client_id || null, client_secret: secretOf(r), options: opts(r) };
    },
    // Safe to send to the head coach: never the secret.
    publicView(programId, provider) {
      const r = row(programId, provider);
      return { client_id: r?.client_id || null, secret_set: !!(r && secretOf(r)), options: opts(r), updated_at: r?.updated_at || null };
    },
    save(programId, provider, { client_id, client_secret, clear_secret, options }, userId, now) {
      const cur = row(programId, provider);
      const next = {
        client_id: client_id !== undefined ? (String(client_id || '').trim() || null) : (cur?.client_id ?? null),
        client_secret_enc: clear_secret ? null : client_secret ? vault.encrypt(String(client_secret).trim()) : (cur?.client_secret_enc ?? null),
        options: JSON.stringify({ ...opts(cur), ...(options || {}) }),
        updated_at: now, updated_by: userId,
      };
      if (cur) db.run('UPDATE integration_credentials SET client_id=?, client_secret_enc=?, options=?, updated_at=?, updated_by=? WHERE program_id=? AND provider=?',
        next.client_id, next.client_secret_enc, next.options, next.updated_at, next.updated_by, programId, provider);
      else db.run('INSERT INTO integration_credentials (program_id, provider, client_id, client_secret_enc, options, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)',
        programId, provider, next.client_id, next.client_secret_enc, next.options, next.updated_at, next.updated_by);
    },
    remove(programId, provider) { db.run('DELETE FROM integration_credentials WHERE program_id=? AND provider=?', programId, provider); },
    // Programs with sign-in turned on for a provider.
    programsWithSignin(provider) {
      return db.all(`SELECT c.program_id, c.options, p.name FROM integration_credentials c JOIN programs p ON p.id=c.program_id WHERE c.provider=?`, provider)
        .filter((r) => opts(r).sso).map((r) => ({ program_id: r.program_id, name: r.name, options: opts(r) }));
    },
  };
}
