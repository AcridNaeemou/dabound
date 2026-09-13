/**
 * mock_supabase.js — a tiny PostgREST stand-in for local testing.
 *
 * DaBound talks to Supabase over its REST API, so the whole database path can be
 * exercised without a Supabase project: this server speaks the same subset
 * (GET ?select=, POST upsert with Prefer: resolution=merge-duplicates, DELETE
 * with ?id=not.in.(...) / ?id=not.is.null) and checks the api key header.
 *
 *   node tools/mock_supabase.js                 # listens on 54321
 *   MOCK_PORT=5433 MOCK_KEY=secret node tools/mock_supabase.js
 *   curl localhost:54321/__store                # dump the tables (debugging)
 *
 * Used by tools/qa_storage.js. It is NOT part of the product.
 */
const http = require('http');

const PORT = +(process.env.MOCK_PORT || 54321);
const KEY = process.env.MOCK_KEY || 'test-service-key';
const TABLES = ['routes', 'jeepneys', 'destinations'];
const store = { routes: new Map(), jeepneys: new Map(), destinations: new Map() };

function send(res, code, body, type) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type || 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : null); } catch (e) { resolve(null); }
    });
  });
}

/* ?id=not.in.("a","b")  ·  ?id=not.is.null  ·  ?id=eq.x */
function matches(id, filter) {
  if (!filter) return true;
  const value = decodeURIComponent(filter);
  if (value.startsWith('not.in.')) {
    const list = value.slice(7).replace(/^\(|\)$/g, '').split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return !list.includes(id);
  }
  if (value === 'not.is.null') return false;
  if (value.startsWith('eq.')) return id === value.slice(3);
  return true;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const auth = req.headers.apikey || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

    if (url.pathname === '/__store') {
      const out = {};
      TABLES.forEach((t) => (out[t] = [...store[t].values()]));
      return send(res, 200, out);
    }
    if (!url.pathname.startsWith('/rest/v1/')) return send(res, 404, { message: 'Not found' });
    if (auth !== KEY) return send(res, 401, { message: 'Invalid API key', hint: 'use the service_role key' });

    const table = url.pathname.split('/')[3];
    if (!TABLES.includes(table)) return send(res, 404, { message: `relation "${table}" does not exist` });
    const rows = store[table];
    const method = req.method.toUpperCase();
    const filter = url.searchParams.get('id');

    if (method === 'GET') {
      const list = [...rows.values()].filter((r) => matches(r.id, filter));
      if ((url.searchParams.get('select') || '') === 'id,data') {
        return send(res, 200, list.map((r) => ({ id: r.id, data: r.data })));
      }
      return send(res, 200, list);
    }

    if (method === 'POST' || method === 'PATCH') {
      const body = await readBody(req);
      const list = Array.isArray(body) ? body : [body];
      if (!list.length || !list[0] || typeof list[0] !== 'object') return send(res, 400, { message: 'invalid body' });
      list.forEach((row) => {
        if (!row.id) return;
        rows.set(row.id, { ...(rows.get(row.id) || {}), ...row });
      });
      return send(res, 201, '', 'application/json');
    }

    if (method === 'DELETE') {
      let removed = 0;
      [...rows.keys()].forEach((id) => {
        if (matches(id, filter)) { rows.delete(id); removed++; }
      });
      res.setHeader('Content-Range', `*/${removed}`);
      return send(res, 204, '');
    }

    return send(res, 405, { message: 'Method not allowed' });
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`mock supabase: listening on http://127.0.0.1:${PORT} (key: ${KEY})`);
  });
