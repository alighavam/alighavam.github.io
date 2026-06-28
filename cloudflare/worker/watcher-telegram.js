/**
 * Telegram + print-watcher relay (runs on Cloudflare edge — works when lab network blocks api.telegram.org).
 *
 * Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, INTERNAL_SECRET
 * Optional: TELEGRAM_WEBHOOK_SECRET
 * KV binding: WATCHER_KV
 */

const WATCHER_HELP =
  'Lab camera print watcher\n\n' +
  '/check — sample now (two 5s bursts)\n' +
  '/status — same as /check\n\n' +
  'Scheduled checks run on the lab Mac; replies come via this bot.';

export async function handleWatcherRoute(request, env, url) {
  if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
    return handleTelegramWebhook(request, env);
  }

  if (!url.pathname.startsWith('/internal/watcher/')) {
    return null;
  }

  if (request.headers.get('X-Watcher-Secret') !== env.INTERNAL_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (url.pathname === '/internal/watcher/poll' && request.method === 'GET') {
    return watcherPoll(env);
  }

  if (url.pathname === '/internal/watcher/notify' && request.method === 'POST') {
    return watcherNotify(request, env);
  }

  if (url.pathname === '/internal/watcher/setup-webhook' && request.method === 'POST') {
    return setupTelegramWebhook(env, url);
  }

  return new Response('Not found', { status: 404 });
}

async function handleTelegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return new Response('Telegram not configured', { status: 500 });
  }

  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (header !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('ok');
  }

  const message = update.message || update.edited_message;
  if (!message?.text) {
    return new Response('ok');
  }

  const chatId = String(message.chat.id);
  if (chatId !== String(env.TELEGRAM_CHAT_ID)) {
    return new Response('ok');
  }

  const text = message.text.trim().toLowerCase();

  if (text.startsWith('/check') || text.startsWith('/status')) {
    if (!env.WATCHER_KV) {
      await sendTelegram(env, 'Print watcher KV not configured on Worker.', chatId);
      return new Response('ok');
    }
    await env.WATCHER_KV.put('pending_check', String(Date.now()), { expirationTtl: 600 });
    await env.WATCHER_KV.put('pending_chat_id', chatId, { expirationTtl: 600 });
    await sendTelegram(env, 'Checking camera now…', chatId);
    return new Response('ok');
  }

  if (text.startsWith('/help') || text.startsWith('/start')) {
    await sendTelegram(env, WATCHER_HELP, chatId);
  }

  return new Response('ok');
}

async function watcherPoll(env) {
  if (!env.WATCHER_KV) {
    return Response.json({ check: false, error: 'KV not bound' });
  }

  const pending = await env.WATCHER_KV.get('pending_check');
  if (!pending) {
    return Response.json({ check: false });
  }

  const chatId = (await env.WATCHER_KV.get('pending_chat_id')) || env.TELEGRAM_CHAT_ID;
  await env.WATCHER_KV.delete('pending_check');
  await env.WATCHER_KV.delete('pending_chat_id');

  return Response.json({ check: true, chat_id: chatId });
}

async function watcherNotify(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return new Response('Telegram not configured', { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const text = body.text;
  if (!text || typeof text !== 'string') {
    return new Response('Missing text', { status: 400 });
  }

  const chatId = body.chat_id ? String(body.chat_id) : env.TELEGRAM_CHAT_ID;
  const ok = await sendTelegram(env, text, chatId);
  if (!ok) {
    return new Response('Telegram send failed', { status: 502 });
  }
  return Response.json({ ok: true });
}

async function setupTelegramWebhook(env, url) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return new Response('TELEGRAM_BOT_TOKEN not set', { status: 500 });
  }

  const webhookUrl = `${url.origin}/telegram/webhook`;
  const payload = { url: webhookUrl, drop_pending_updates: true };
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    payload.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  }

  const resp = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  const result = await resp.text();
  return new Response(result, {
    status: resp.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sendTelegram(env, text, chatId) {
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}
