/**
 * Password gate for cam.alighavam.com — runs on Cloudflare's edge.
 * Secrets (never in GitHub): VIEWER_PASSWORD, STREAM_TOKEN, INTERNAL_SECRET
 */

const COOKIE_NAME = 'lab_cam_session';
const SESSION_DAYS = 7;
const CAMERA_PATHS = new Set(['/stream', '/frame']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.headers.get('X-Internal-Stream') === env.INTERNAL_SECRET) {
      return forwardToCamera(request, env);
    }

    if (url.pathname === '/auth' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/logout') {
      return logout();
    }

    if (CAMERA_PATHS.has(url.pathname)) {
      if (!(await hasValidSession(request, env))) {
        return new Response('Unauthorized', { status: 401 });
      }
      return proxyCamera(request, env, url.pathname);
    }

    if (url.pathname === '/' || url.pathname === '/view') {
      if (await hasValidSession(request, env)) {
        return viewerPage();
      }
      return loginPage(url.pathname === '/view' ? 'Incorrect password.' : '');
    }

    return new Response('Not found', { status: 404 });
  },
};

async function forwardToCamera(request, env) {
  const url = new URL(request.url);
  if (!CAMERA_PATHS.has(url.pathname)) {
    return new Response('Forbidden', { status: 403 });
  }
  if (url.searchParams.get('token') !== env.STREAM_TOKEN) {
    return new Response('Forbidden', { status: 403 });
  }

  const originResponse = await fetch(url.toString(), {
    method: request.method,
    headers: { Accept: request.headers.get('Accept') || '*/*' },
    redirect: 'follow',
  });

  return passThroughResponse(originResponse);
}

async function proxyCamera(request, env, pathname) {
  if (!env.STREAM_TOKEN || !env.INTERNAL_SECRET) {
    return new Response('Worker misconfigured: STREAM_TOKEN or INTERNAL_SECRET missing', { status: 500 });
  }

  const url = new URL(request.url);
  url.pathname = pathname;
  url.searchParams.set('token', env.STREAM_TOKEN);

  const originResponse = await fetch(url.toString(), {
    method: request.method,
    headers: {
      Accept: request.headers.get('Accept') || '*/*',
      'X-Internal-Stream': env.INTERNAL_SECRET,
    },
    redirect: 'follow',
  });

  return passThroughResponse(originResponse);
}

function passThroughResponse(originResponse) {
  if (!originResponse.ok) {
    return new Response(`Camera upstream error (${originResponse.status})`, {
      status: originResponse.status,
    });
  }

  const headers = new Headers(originResponse.headers);
  headers.set('Cache-Control', 'no-store');

  return new Response(originResponse.body, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers,
  });
}

async function handleLogin(request, env) {
  let password = '';
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = await request.json();
    password = body.password || '';
  } else {
    const form = await request.formData();
    password = form.get('password') || '';
  }

  if (!timingSafeEqual(password, env.VIEWER_PASSWORD)) {
    if (contentType.includes('application/json')) {
      return Response.json({ ok: false }, { status: 401 });
    }
    return loginPage('Incorrect password.');
  }

  const session = await signSession(env);
  const headers = new Headers();
  headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`
  );
  headers.set('Location', '/');
  return new Response(null, { status: 302, headers });
}

function logout() {
  const headers = new Headers();
  headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
  );
  headers.set('Location', '/');
  return new Response(null, { status: 302, headers });
}

async function hasValidSession(request, env) {
  const cookie = getCookie(request, COOKIE_NAME);
  if (!cookie) {
    return false;
  }
  return verifySession(cookie, env);
}

async function signSession(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `v1.${exp}`;
  const sig = await hmacHex(env.SESSION_SECRET || env.VIEWER_PASSWORD, payload);
  return `${payload}.${sig}`;
}

async function verifySession(value, env) {
  const parts = value.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [version, expStr, sig] = parts;
  if (version !== 'v1') {
    return false;
  }

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const payload = `${version}.${expStr}`;
  const expected = await hmacHex(env.SESSION_SECRET || env.VIEWER_PASSWORD, payload);
  return timingSafeEqual(sig, expected);
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return null;
}

function timingSafeEqual(a, b) {
  const aa = String(a);
  const bb = String(b);
  if (aa.length !== bb.length) {
    return false;
  }
  let out = 0;
  for (let i = 0; i < aa.length; i++) {
    out |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  }
  return out === 0;
}

function loginPage(errorMessage = '') {
  const error = errorMessage
    ? `<p style="color:#f87171;margin:0 0 12px">${escapeHtml(errorMessage)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Lab Camera</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:Inter,system-ui,sans-serif;background:#050408;color:#f3f4f6;padding:20px}
    .card{width:100%;max-width:420px;padding:32px;border-radius:24px;border:1px solid rgba(255,255,255,.1);
    background:rgba(255,255,255,.03);backdrop-filter:blur(12px)}
    h1{margin:0 0 8px;font-size:1.6rem}p.sub{color:#a1a1aa;margin:0 0 20px;font-size:.95rem}
    label{display:block;margin-bottom:8px;font-size:.9rem;color:#a1a1aa}
    input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);
    background:rgba(255,255,255,.04);color:#fff;font-size:1rem;margin-bottom:16px}
    button{width:100%;padding:12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);
    background:rgba(255,255,255,.05);color:#fff;font-size:.95rem;cursor:pointer}
    button:hover{box-shadow:0 0 16px rgba(139,92,246,.4)}
  </style>
</head>
<body>
  <section class="card">
    <h1>Lab Camera</h1>
    <p class="sub">Private live view. Password required.</p>
    ${error}
    <form method="POST" action="/auth">
      <label for="password">Viewer password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">View stream</button>
    </form>
  </section>
</body>
</html>`;

  return htmlResponse(html);
}

function viewerPage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Lab Camera — Live</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Inter,system-ui,sans-serif;
    background:#050408;color:#f3f4f6;padding:24px}
    .wrap{max-width:960px;margin:0 auto}
    h1{margin:0 0 8px;font-size:1.6rem}p.sub{color:#a1a1aa;margin:0 0 16px}
    img{width:100%;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:#000;aspect-ratio:4/3;object-fit:contain}
    .actions{margin-top:16px;display:flex;gap:12px;flex-wrap:wrap}
    a,button{padding:10px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.2);
    background:rgba(255,255,255,.05);color:#fff;text-decoration:none;font-size:.9rem;cursor:pointer}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Lab Camera</h1>
    <p class="sub" id="status">Connecting...</p>
    <img id="stream" alt="Live lab camera stream">
    <div class="actions">
      <button type="button" onclick="reloadStream()">Reload stream</button>
      <a href="/logout">Log out</a>
    </div>
  </div>
  <script>
    const img = document.getElementById('stream');
    const status = document.getElementById('status');
    const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
    let pollTimer = null;
    let failCount = 0;

    img.onload = () => {
      failCount = 0;
      status.textContent = isMobile ? 'Live (mobile)' : 'Live';
    };
    img.onerror = () => {
      failCount += 1;
      if (failCount >= 3) {
        status.textContent = 'Stream unavailable — check ESP32 and tunnel.';
      }
    };

    function startMjpeg() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      img.src = '/stream?_=' + Date.now();
    }

    function startFramePoll() {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      function tick() {
        img.src = '/frame?_=' + Date.now();
      }
      tick();
      pollTimer = setInterval(tick, 400);
    }

    function reloadStream() {
      status.textContent = 'Reconnecting...';
      failCount = 0;
      if (isMobile) {
        startFramePoll();
      } else {
        startMjpeg();
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isMobile) {
        reloadStream();
      }
    });

    if (isMobile) {
      status.textContent = 'Connecting (mobile mode)...';
      startFramePoll();
    } else {
      startMjpeg();
    }
  </script>
</body>
</html>`;

  return htmlResponse(html);
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
