#!/usr/bin/env node
/**
 * scripts/trial-admin.js — お試し買い手の管理(ローカル専用、公開APIには一切存在しない)。
 *
 * functions/api/trial-status.js・functions/api/unlock.jsが参照するKV
 * (jisseki_trial_kv)に、買い手ごとのランダム解除コードを直接書き込む。
 * 認証にはCF_TRIAL_ADMIN_TOKEN環境変数(Account > Workers KV Storage: Edit
 * 権限のAPIトークン)を使う——リポジトリにもコードにもトークンそのものは
 * 一切含めない。
 *
 * 使い方:
 *   CF_TRIAL_ADMIN_TOKEN=<token> node scripts/trial-admin.js grant buyer@example.com
 *     → お試し開始(今日の日付で記録)+ランダム解除コードを発行し、画面に表示する
 *       (このコードを買い手に別途伝える。KVには平文で保存しない=ハッシュのみ)
 *
 *   CF_TRIAL_ADMIN_TOKEN=<token> node scripts/trial-admin.js status buyer@example.com
 *     → 現在の記録(開始日・支払い済みかどうか)を表示する
 *
 *   CF_TRIAL_ADMIN_TOKEN=<token> node scripts/trial-admin.js mark-paid buyer@example.com
 *     → 解除コード無しで直接「支払い済み」にする(本番買い切り・コード紛失時の救済用)
 *
 * 注意: このスクリプトを実行しただけではCloudflare Accessの許可リストには
 * 追加されない。許可リストへの追加は従来通りCloudflareダッシュボード
 * (Zero Trust > Access > Applications > jisseki-app-pwa.pages.dev > Policies
 * > Allowed buyers)で別途行うこと。
 */

const crypto = require('crypto');

const ACCOUNT_ID = 'a2b27bd0892d314d2d1f469ecf0b0fe6';
const NAMESPACE_ID = 'f63dd99653bd4445abe49a3248a873b5';
const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}`;

const token = process.env.CF_TRIAL_ADMIN_TOKEN;
if (!token) {
  console.error('環境変数 CF_TRIAL_ADMIN_TOKEN が設定されていません。');
  process.exit(1);
}

const [, , command, emailArg] = process.argv;
if (!command || !emailArg) {
  console.error('使い方: node scripts/trial-admin.js <grant|status|mark-paid> <email>');
  process.exit(1);
}
const email = emailArg.toLowerCase().trim();
const key = `trial:${email}`;

async function kvGet() {
  const res = await fetch(`${API_BASE}/values/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV get failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function kvPut(value) {
  const res = await fetch(`${API_BASE}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`KV put failed: ${res.status} ${await res.text()}`);
}

function randomCode() {
  // 読み間違えにくい形式(大文字4桁-4桁、紛らわしい0/O・1/I/Lを除外)。
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const part = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${part()}-${part()}`;
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function main() {
  if (command === 'status') {
    const record = await kvGet();
    if (!record) {
      console.log(`${email}: 記録なし(まだアプリを一度も開いていません)`);
      return;
    }
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (command === 'grant') {
    const existing = await kvGet();
    const code = randomCode();
    const record = {
      started_at: existing?.started_at || new Date().toISOString(),
      code_hash: sha256Hex(code),
      paid: false,
      paid_at: null,
    };
    await kvPut(record);
    console.log(`発行しました。`);
    console.log(`  メール: ${email}`);
    console.log(`  開始日: ${record.started_at}`);
    console.log(`  解除コード(買い手に伝える。これが最後の表示機会です): ${code}`);
    console.log('');
    console.log('※ 忘れずにCloudflare Access(Allowed buyers)にもこのメールを追加してください。');
    return;
  }

  if (command === 'mark-paid') {
    const existing = await kvGet();
    const record = {
      started_at: existing?.started_at || new Date().toISOString(),
      code_hash: existing?.code_hash || null,
      paid: true,
      paid_at: new Date().toISOString(),
    };
    await kvPut(record);
    console.log(`${email} を支払い済みにしました。`);
    return;
  }

  console.error(`不明なコマンド: ${command}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
