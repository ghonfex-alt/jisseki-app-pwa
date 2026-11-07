/**
 * POST /api/unlock — お試し→購入済みへの切り替え(解除コード入力)。
 *
 * trial-status.jsと同じくCloudflare Accessが付与する
 * `Cf-Access-Authenticated-User-Email`ヘッダで本人を特定する。
 * 解除コードはscripts/trial-admin.js(ローカル、管理者専用)で買い手ごとに
 * ランダム生成し、KVに平文ではなくSHA-256ハッシュで保存してある
 * (旧local/license.jsと同じ方針: コード自体はどこにも保存しない)。
 *
 * body: { code: string }
 */

export async function onRequestPost(context) {
  const { request, env } = context;
  const email = (request.headers.get('Cf-Access-Authenticated-User-Email') || '').toLowerCase().trim();
  if (!email) {
    return json({ error: 'no authenticated email' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: '不正なリクエストです' }, 400);
  }

  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return json({ error: '解除コードを入力してください' }, 400);
  }

  const key = `trial:${email}`;
  const record = await env.TRIAL_KV.get(key, { type: 'json' });
  if (!record || !record.code_hash) {
    return json({ error: 'このアカウントには解除コードが発行されていません' }, 400);
  }

  const inputHash = await sha256Hex(code);
  if (inputHash !== record.code_hash) {
    return json({ error: '解除コードが正しくありません' }, 401);
  }

  record.paid = true;
  record.paid_at = new Date().toISOString();
  await env.TRIAL_KV.put(key, JSON.stringify(record));

  return json({ ok: true });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
