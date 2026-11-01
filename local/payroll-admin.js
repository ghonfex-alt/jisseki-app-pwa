/**
 * local/payroll-admin.js — 給与確定・確定解除・個別調整(routers/payroll_admin.pyの移植)。
 *
 * 依存: db.js, local-api.js, local/store.js(window.getStores),
 * local/payroll.js(window.getMonthlyPayroll)。<script>タグは
 * db.js → local-api.js → local/store.js → local/staff.js → local/daily.js →
 * local/tax-table-r8.js → local/payroll.js → local/payroll-admin.js の順で
 * 読み込むこと(Task5の関数を本ファイルが呼ぶため、local/payroll.jsより後)。
 *
 * 移植元: JISSEKI_SRC/routers/payroll_admin.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 *
 * ── 本ファイルが定義するグローバル関数について(遅延バインディングの受け口) ──
 * Task3〜5(local/staff.js, local/daily.js, local/payroll.js)は、確定済み月の
 * 編集拒否(423相当)のため `window.isLocked(year, month)` と
 * `window.getSnapshot(year, month, store_id)` を「定義されていれば呼ぶ」遅延
 * バインディングで参照している(未定義の間は常に「ロック無し」)。本ファイルが
 * 読み込まれた時点でこの2つをグローバルに定義することで、それら既存コードを
 * 一切変更せずにロック機能が有効になる。呼び出し側の実際の呼び方
 * (tests/local-staff.test.js・tests/local-daily.test.js・local/payroll.js参照)
 * に合わせ、シグネチャは下記の通りにすること(ズレると静かに無視され
 * ロックが効かなくなるバグになる):
 *   - isLocked(year, month) は**同期**関数(呼び出し側がawaitしていないため)。
 *   - getSnapshot(year, month, storeId) は非同期(呼び出し側がawaitしている)。
 *
 * ── isLockedを同期関数にするためのメモリキャッシュについて ──
 * Python版のis_locked()はファイル読み込み(同期I/O)なので毎回最新の状態を
 * 読める。IndexedDBは非同期APIしか持たないため、同じ意味で「毎回最新」の
 * 同期関数は原理的に作れない。そのため、ロック状態をメモリ上のキャッシュ
 * (_locksCache)に保持し、isLocked()はこのキャッシュだけを見る同期関数にした。
 * - lockMonth/unlockMonth(本ファイル経由の変更)は、IndexedDBへの書き込みが
 *   成功した直後にキャッシュも同期的に更新するため、本ファイル経由の変更は
 *   isLocked()に即時反映される。
 * - ページ読み込み直後、まだ一度もlockMonth/unlockMonthを呼んでいない状態で
 *   前回セッションまでの確定状態(IndexedDBに永続化済み)を反映するため、本
 *   ファイル読み込み時にバックグラウンドで一度だけIndexedDBから読み込む
 *   (ensureLocksLoaded、fire-and-forget)。アプリ起動シーケンス(Task11で
 *   実装予定のbootstrap)がUIを操作可能にする前に
 *   `await ensureLocksLoaded()` を呼べば、この一瞬の空白も無くなる。
 */
(function (root) {
  "use strict";

  var LOCKS_STORE = "payroll_locks";
  var SNAPSHOTS_STORE = "payroll_snapshots";

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function _pad2(n) {
    return String(n).padStart(2, "0");
  }

  // 設計書(docs/superpowers/specs/2026-11-01-pwa-rewrite-design.md)の
  // キー仕様: payroll_locks = "${year}-${month}", payroll_snapshots =
  // "${year}-${month}-${store_id}"。月は桁数が揺れると辞書順ソート・
  // 前方一致検索(unlockMonthのprefix削除)が壊れるため2桁ゼロ埋めにする。
  function _lockKey(year, month) {
    return year + "-" + _pad2(month);
  }

  function _snapshotKey(year, month, storeId) {
    return year + "-" + _pad2(month) + "-" + storeId;
  }

  // ── ロック状態のメモリキャッシュ(isLockedを同期関数にするため) ──────────
  var _locksCache = {}; // { "2026-06": true, ... }
  var _locksCacheLoadPromise = null;

  function _rebuildCacheFrom(records) {
    var cache = {};
    (records || []).forEach(function (r) {
      if (_isPlainObject(r) && r.year !== undefined && r.year !== null && r.month !== undefined && r.month !== null) {
        cache[_lockKey(r.year, r.month)] = true;
      }
    });
    _locksCache = cache;
  }

  // IndexedDBから"payroll_locks"全件を読み、メモリキャッシュを作り直す。
  // 他タスクのファイル読み込み時に一度だけ自動で呼ばれる(fire-and-forget)ほか、
  // Task11のbootstrapが起動シーケンス中に明示的にawaitできるよう公開する。
  function ensureLocksLoaded() {
    if (!_locksCacheLoadPromise) {
      _locksCacheLoadPromise = dbGetAll(LOCKS_STORE)
        .then(function (all) {
          _rebuildCacheFrom(all);
          return _locksCache;
        })
        .catch(function (err) {
          // 読み込み失敗時は次回呼び出しで再試行できるようにしておく
          // (fire-and-forgetで投げっぱなしにすると永久に古いキャッシュのまま固まる)。
          _locksCacheLoadPromise = null;
          throw err;
        });
    }
    return _locksCacheLoadPromise;
  }

  // is_locked(payroll_admin.py)の移植。**同期関数**(ファイル先頭コメント参照)。
  function isLocked(year, month) {
    return !!_locksCache[_lockKey(year, month)];
  }

  // get_snapshot(payroll_admin.py)の移植。
  async function getSnapshot(year, month, storeId) {
    return dbGet(SNAPSHOTS_STORE, _snapshotKey(year, month, storeId));
  }

  // get_locks(payroll_admin.py)の移植。GET /payroll/locks
  // 常にIndexedDBから読み直す(こちらはユーザーが明示的に呼ぶエンドポイントで
  // 同期である必要が無いため、キャッシュに頼らず最新の状態を返す)。
  async function getLocks() {
    var all = await dbGetAll(LOCKS_STORE);
    var result = {};
    (all || []).forEach(function (r) {
      if (_isPlainObject(r) && r.year !== undefined && r.year !== null && r.month !== undefined && r.month !== null) {
        result[_lockKey(r.year, r.month)] = true;
      }
    });
    return result;
  }

  // lock_month(payroll_admin.py)の移植。POST /payroll/lock/{year}/{month}
  async function lockMonth(year, month) {
    // 既にロック済みの月への再ロックを拒否する(payroll_admin.pyのコメント
    // 参照: 偶発的な安全性に頼らず明示的に拒否する)。
    if (isLocked(year, month)) {
      throw new ApiError(423, year + "年" + month + "月は既に給与確定済みです");
    }

    await dbPut(LOCKS_STORE, _lockKey(year, month), {
      year: year,
      month: month,
      locked_at: new Date().toISOString(),
    });
    // IndexedDBへの書き込み成功直後にキャッシュも更新する(他モジュールの
    // isLocked()呼び出しに即時反映させるため)。
    _locksCache[_lockKey(year, month)] = true;

    // ロックした時点の計算結果を店舗ごとにスナップショット保存する。
    // この時点でisLocked(year, month)は既にtrueなので、getMonthlyPayroll内の
    // ロック済み月判定(local/payroll.js参照)はスナップショットを探すが、
    // まだ書き込み前なのでundefined -> 素通りして実計算が行われる
    // (payroll_admin.pyと同じ順序: ロック書き込み → スナップショット計算)。
    var stores = await getStores();
    var storeIds = Object.keys(stores);
    for (var i = 0; i < storeIds.length; i++) {
      var storeId = storeIds[i];
      var snapshot = await getMonthlyPayroll(year, month, storeId);
      await dbPut(SNAPSHOTS_STORE, _snapshotKey(year, month, storeId), snapshot);
    }

    return { locked: _lockKey(year, month) };
  }

  // unlock_month(payroll_admin.py)の移植。DELETE /payroll/lock/{year}/{month}
  // Python版と同じく、ロックされていない月に対しても例外を投げず無条件で成功する。
  async function unlockMonth(year, month) {
    await dbDelete(LOCKS_STORE, _lockKey(year, month));
    delete _locksCache[_lockKey(year, month)];

    // 解除時はスナップショットも破棄する(再ロック時に最新データで作り直すため)。
    var allSnapshots = await dbGetAll(SNAPSHOTS_STORE);
    for (var i = 0; i < allSnapshots.length; i++) {
      var snap = allSnapshots[i];
      if (_isPlainObject(snap) && snap.year === year && snap.month === month && snap.store_id) {
        await dbDelete(SNAPSHOTS_STORE, _snapshotKey(snap.year, snap.month, snap.store_id));
      }
    }

    return { unlocked: _lockKey(year, month) };
  }

  // テストでのみ使用、本番コードパスからは呼ばない(local-api.jsの
  // _resetRoutesForTestと同じ位置づけ)。メモリキャッシュを空にし、次の
  // ensureLocksLoaded()呼び出しでIndexedDBから再読込させる
  // (「アプリ再起動直後に前回ロックを正しく読み直すか」をテストするため)。
  function _resetLocksCacheForTest() {
    _locksCache = {};
    _locksCacheLoadPromise = null;
  }

  root.isLocked = isLocked;
  root.getSnapshot = getSnapshot;
  root.ensureLocksLoaded = ensureLocksLoaded;
  root.getLocks = getLocks;
  root.lockMonth = lockMonth;
  root.unlockMonth = unlockMonth;
  root._resetLocksCacheForTest = _resetLocksCacheForTest;

  registerRoute("GET", "/payroll/locks", function () {
    return getLocks();
  });
  registerRoute("POST", "/payroll/lock/:year/:month", function (params) {
    return lockMonth(parseInt(params.year, 10), parseInt(params.month, 10));
  });
  registerRoute("DELETE", "/payroll/lock/:year/:month", function (params) {
    return unlockMonth(parseInt(params.year, 10), parseInt(params.month, 10));
  });

  // ページ読み込み時(本ファイルがrequire/<script>される時点)に一度だけ、
  // 前回セッションまでの確定状態をバックグラウンドで読み込んでおく
  // (ファイル先頭コメント参照)。
  ensureLocksLoaded();
})(typeof window !== "undefined" ? window : globalThis);
