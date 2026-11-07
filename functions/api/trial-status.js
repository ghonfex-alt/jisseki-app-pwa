/**
 * GET /api/trial-status — お試し期間の状態を返すCloudflare Pages Function。
 *
 * このドメイン(jisseki-app-pwa.pages.dev)は丸ごとCloudflare Accessの配下にある
 * (関連: _headers, Access Application「jisseki-app-pwa.pages.dev」)。Access経由で
 * 到達したリクエストには、Cloudflareが自動で`Cf-Access-Authenticated-User-Email`
 * ヘッダを付与する(本アプリ側で何も実装しなくても、認証済みメールアドレスが
 * ここで確実に読み取れる——JWT検証を自前で書く必要が無い)。
 *
 * なぜブラウザのIndexedDBだけで判定しないか(2026-11-07、ユーザーとの合意):
 * クライアント側だけの記録は「ブラウザのデータを消せば振り出しに戻る」弱点が
 * ある(旧local/license.jsと同じ限界)。ここでは「お試し開始日」の真実の記録を
 * KV(ブラウザの外、買い手が操作できない場所)に1個だけ持たせることで、
 * データを消されても開始日はリセットされないようにする。
 *
 * KVのキー形式: `trial:<email(小文字)>`
 * 値: { started_at: ISO8601, code_hash: string|null, paid: boolean, paid_at: ISO8601|null }
 *
 * 買い手ごとの解除コードはscripts/trial-admin.js(ローカル実行、管理者専用)で
 * 事前に発行してKVに書き込んでおく想定。ここでは「まだコードが無い」状態
 * (code_hash===null)でも記録自体は自動作成する(Accessの許可リストにだけ先に
 * 追加されてしまった場合のフォールバック)。
 */

const TRIAL_DAYS = 30;

export async function onRequestGet(context) {
  const { request, env } = context;
  const email = (request.headers.get('Cf-Access-Authenticated-User-Email') || '').toLowerCase().trim();
  if (!email) {
    return json({ error: 'no authenticated email' }, 401);
  }

  const key = `trial:${email}`;
  let record = await env.TRIAL_KV.get(key, { type: 'json' });

  if (!record) {
    record = {
      started_at: new Date().toISOString(),
      code_hash: null,
      paid: false,
      paid_at: null,
    };
    await env.TRIAL_KV.put(key, JSON.stringify(record));
  }

  const startedAt = new Date(record.started_at).getTime();
  const elapsedDays = (Date.now() - startedAt) / (1000 * 60 * 60 * 24);
  const daysRemaining = Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays));
  const expired = !record.paid && daysRemaining <= 0;

  return json({
    started_at: record.started_at,
    days_remaining: daysRemaining,
    paid: !!record.paid,
    expired,
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
