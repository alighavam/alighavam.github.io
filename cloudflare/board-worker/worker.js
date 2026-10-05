/**
 * Storage + password gate for the paper board (alighavam.com/board/).
 * Data lives in D1. Secrets (never in GitHub): BOARD_PASSWORD, SESSION_SECRET
 */

const SESSION_DAYS = 180;
const MAX_IMAGE_BYTES = 1_500_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 8;
const ID = /^[\w-]{1,64}$/;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cards (
     id TEXT PRIMARY KEY,
     stage TEXT NOT NULL,
     position REAL NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL DEFAULT 'sage',
     notes TEXT NOT NULL DEFAULT '',
     image TEXT,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS images (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     data BLOB NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS login_failures_ip ON login_failures (ip, at)`,
];

let schemaReady = null;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    let response;
    try {
      schemaReady ??= env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql))).catch((err) => {
        schemaReady = null;
        throw err;
      });
      await schemaReady;
      response = await route(request, env, new URL(request.url));
    } catch (err) {
      console.error(err);
      response = json({ error: 'Server error' }, 500);
    }

    for (const [key, value] of Object.entries(cors)) {
      response.headers.set(key, value);
    }
    return response;
  },
};

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/login' && method === 'POST') {
    return login(request, env);
  }

  if (!(await isAuthorized(request, env))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (pathname === '/board' && method === 'GET') {
    return getBoard(env);
  }

  const cardMatch = pathname.match(/^\/cards\/([^/]+)$/);
  if (cardMatch && ID.test(cardMatch[1])) {
    if (method === 'PUT') return putCard(request, env, cardMatch[1]);
    if (method === 'DELETE') return deleteCard(env, cardMatch[1]);
  }

  if (pathname === '/images' && method === 'POST') {
    return postImage(request, env);
  }

  const imageMatch = pathname.match(/^\/images\/([^/]+)$/);
  if (imageMatch && ID.test(imageMatch[1]) && method === 'GET') {
    return getImage(env, imageMatch[1]);
  }

  return json({ error: 'Not found' }, 404);
}

// ---------- Auth ----------

async function login(request, env) {
  if (!env.BOARD_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: 'Board is not configured yet.' }, 500);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const since = Date.now() - LOGIN_WINDOW_MS;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?')
    .bind(ip, since)
    .first();
  if (n >= MAX_FAILED_LOGINS) {
    return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);
  }

  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== 'string' || !(await safeEqual(password, env.BOARD_PASSWORD))) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_failures (ip, at) VALUES (?, ?)').bind(ip, Date.now()),
      env.DB.prepare('DELETE FROM login_failures WHERE at < ?').bind(since),
    ]);
    return json({ error: 'Wrong password.' }, 401);
  }

  const expires = String(Date.now() + SESSION_DAYS * 86_400_000);
  return json({ token: `${expires}.${await sign(expires, env.SESSION_SECRET)}` });
}

async function isAuthorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  const [expires, signature] = header.replace(/^Bearer /, '').split('.');
  if (!expires || !signature || !env.SESSION_SECRET || Number(expires) < Date.now()) {
    return false;
  }
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), fromBase64Url(signature), encode(expires));
  } catch {
    return false;
  }
}

async function sign(message, secret) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encode(message));
  return toBase64Url(new Uint8Array(signature));
}

function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', encode(s))));
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------- Cards ----------

async function getBoard(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, stage, position, title, color, notes, image, updated_at AS updatedAt FROM cards ORDER BY position',
  ).all();
  return json({ cards: results });
}

async function putCard(request, env, id) {
  const body = await request.json().catch(() => null);
  const card = body && cleanCard(id, body);
  if (!card) {
    return json({ error: 'Invalid card' }, 400);
  }

  const previous = await env.DB.prepare('SELECT image FROM cards WHERE id = ?').bind(id).first();
  const statements = [
    env.DB.prepare(
      `INSERT INTO cards (id, stage, position, title, color, notes, image, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         stage = excluded.stage, position = excluded.position, title = excluded.title,
         color = excluded.color, notes = excluded.notes, image = excluded.image,
         updated_at = excluded.updated_at`,
    ).bind(card.id, card.stage, card.position, card.title, card.color, card.notes, card.image, card.updatedAt),
  ];
  if (previous?.image && previous.image !== card.image) {
    statements.push(env.DB.prepare('DELETE FROM images WHERE id = ?').bind(previous.image));
  }
  await env.DB.batch(statements);
  return json({ card });
}

async function deleteCard(env, id) {
  const previous = await env.DB.prepare('SELECT image FROM cards WHERE id = ?').bind(id).first();
  const statements = [env.DB.prepare('DELETE FROM cards WHERE id = ?').bind(id)];
  if (previous?.image) {
    statements.push(env.DB.prepare('DELETE FROM images WHERE id = ?').bind(previous.image));
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}

function cleanCard(id, body) {
  const { stage, position, title = '', color = 'sage', notes = '', image = null } = body;
  if (typeof stage !== 'string' || !/^[a-z0-9-]{1,40}$/.test(stage)) return null;
  if (typeof position !== 'number' || !Number.isFinite(position)) return null;
  if (typeof title !== 'string' || typeof notes !== 'string') return null;
  if (typeof color !== 'string' || !/^[a-z]{1,20}$/.test(color)) return null;
  if (image !== null && (typeof image !== 'string' || !ID.test(image))) return null;
  return {
    id,
    stage,
    position,
    title: title.slice(0, 300),
    color,
    notes: notes.slice(0, 20_000),
    image,
    updatedAt: Date.now(),
  };
}

// ---------- Images ----------

async function postImage(request, env) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) {
    return json({ error: 'Unsupported image type' }, 415);
  }
  const data = await request.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) {
    return json({ error: 'Image too large' }, 413);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO images (id, type, data, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, type, data, Date.now())
    .run();
  return json({ id });
}

async function getImage(env, id) {
  const row = await env.DB.prepare('SELECT type, data FROM images WHERE id = ?').bind(id).first();
  if (!row) {
    return json({ error: 'Not found' }, 404);
  }
  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': row.type,
      // Image ids are never reused, so each device only downloads a cover once.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}

// ---------- Helpers ----------

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) {
    return { Vary: 'Origin' };
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function encode(s) {
  return new TextEncoder().encode(s);
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
