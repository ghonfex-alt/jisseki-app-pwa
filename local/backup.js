/**
 * local/backup.js — データのエクスポート/インポート(新設。JISSEKI_SRCには存在しない)。
 *
 * 依存: db.js(window.DB_STORE_NAMES, dbGetAllWithKeys, dbPut, dbClear)、
 * local-api.js(window.registerRoute, window.ApiError)、local/export.js
 * (window.downloadWorkbook — Blob+ファイル名を受け取ってnavigator.share優先/
 * <a>フォールバックでダウンロードさせる、Task10の汎用ダウンロード処理。
 * 名前はExcel出力用だが実装はBlobの種類を問わない汎用関数なのでそのまま使い回す)。
 * <script>タグは db.js → local-api.js → (他のlocal/*.js) → local/export.js →
 * local/backup.js の順で読み込むこと。
 *
 * Node.js (tests/setup.js 経由の環境) でも
 * require("../db.js"); require("../local-api.js"); require("../local/export.js");
 * require("../local/backup.js"); の順でrequireするだけで同じグローバル関数が
 * 使えるようにしてある。
 *
 * 移植元: 無し(本計画書冒頭の追加要件とは別の、計画書Task12で新設された機能。
 * 設計書「データのエクスポート/インポート」節が仕様)。
 *
 * ── キー欠落問題への対処(db.jsへの共通ヘルパー追加で解決) ───────────────────
 * db.jsのdbGetAllは値だけを返しキーを失う(本アプリの全ストアはout-of-line
 * キー——createObjectStoreにkeyPathを指定していない——のため、キーまで含めて
 * 読むにはカーソルが必要)。Task3のlocal/targets.js・Task6のlocal/payroll-admin.js
 * が既に同じ理由でカーソルを個別に書いており(それぞれ自ファイル内に閉じる方針
 * だった)、本タスクは「全オブジェクトストアを汎用的にバックアップする」という
 * 性質上どのストアも例外なくキーが必要になるため、3つ目の重複実装にするのではなく
 * db.js側に`dbGetAllWithKeys`(カーソルでキー・値を両方読む)・`dbClear`
 * (ストア全件削除)を共通ヘルパーとして追加した(db.js参照)。既存のdbGet/dbPut/
 * dbGetAll/dbDelete/dbOpenの挙動・戻り値は変えていないため、Task1〜11の
 * テストへの影響は無い(追加のみ)。
 *
 * ── バックアップの形(キー・値のペア配列)にした理由 ────────────────────────
 * ストアによってキーの型が異なる(例: "daily"は年がnumber、"staff"/"stores"は
 * 文字列id、"settings"/"license"は固定文字列、"payroll_locks"等は複合文字列)。
 * JSON.stringifyはオブジェクトのプロパティ名を必ず文字列化してしまうため、
 * { "2026": {...} } のようにオブジェクトのキーとして保存すると、復元時に
 * dbPut("daily", "2026", ...) のように文字列キーで書き込まれてしまい、
 * 既存コード(local/daily.js)が常にNumber(year)で読みに来るのと型が噛み合わず
 * 復元したデータが見えなくなる(IndexedDBはキーの型を区別する)。これを避ける
 * ため、ストアごとに [{key, value}, ...] という配列形式で保存する(配列の要素
 * はJSON内では普通の値なので、key:2026 のようなnumber型がそのまま保存・復元
 * される)。
 *
 * ── インポート時に「全件クリアしてから書き戻す」方針にした理由 ───────────────
 * バックアップ後にアプリ側で追加・削除されたレコードがある場合、キー単位の
 * 上書きだけでは「バックアップ時点には無かったが今は存在する」レコードが
 * 残ってしまい、設計書・計画書が意図する「現在のデータを上書きする」(完全な
 * リストア)にならない。そのため対象ストアは一旦dbClearしてから、バックアップ
 * 内の全エントリをdbPutし直す。
 *
 * ── インポート後にメモリキャッシュを再構築しない理由(フロント側の責務) ─────
 * 本ファイルはIndexedDBの読み書きのみ行う(他のlocal/*.jsと同じくDOM操作は
 * しない)。インポートは全ストアを書き換えるため、他モジュールが保持する
 * メモリキャッシュ(local/payroll-admin.jsの_locksCache、frontend/app.jsの
 * window.STORE_NAME・App._getCache等)が全て古いままになる。これらを
 * 個別に洗い出して無効化するより、インポート成功後にページ全体をリロード
 * して確実に最新状態から始める方が安全で読みやすい。ページリロードは
 * DOM操作なのでフロント側(frontend/settings.js)の責務とし、本ファイルは
 * データの読み書きだけに専念する。
 */
(function (root) {
  "use strict";

  var BACKUP_FORMAT = "jisseki-app-pwa-backup";
  var BACKUP_VERSION = 1;

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function _pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  // ダウンロードファイル名用のタイムスタンプ(YYYYMMDD_HHMM)。
  function _timestampForFilename() {
    var d = new Date();
    return (
      d.getFullYear() + _pad2(d.getMonth() + 1) + _pad2(d.getDate()) +
      "_" + _pad2(d.getHours()) + _pad2(d.getMinutes())
    );
  }

  // export_backup相当。window.DB_STORE_NAMES(db.js)を正とするため、
  // ここではストア一覧を自前で持たない(将来ストアが増えてもこのファイルは
  // 自動的に追従する)。
  async function exportBackup() {
    var stores = {};
    for (var i = 0; i < root.DB_STORE_NAMES.length; i++) {
      var name = root.DB_STORE_NAMES[i];
      stores[name] = await dbGetAllWithKeys(name);
    }
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      stores: stores,
    };
  }

  // バックアップJSONの形式を検証する。不正ならApiError(400)を投げる。
  function _validateBackupPayload(data) {
    if (!_isPlainObject(data)) {
      throw new ApiError(400, "バックアップデータの形式が不正です(JSONオブジェクトではありません)");
    }
    if (data.format !== BACKUP_FORMAT) {
      throw new ApiError(400, "このアプリ用のバックアップファイルではありません");
    }
    if (!_isPlainObject(data.stores)) {
      throw new ApiError(400, "バックアップデータに stores がありません");
    }
    root.DB_STORE_NAMES.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(data.stores, name) && !Array.isArray(data.stores[name])) {
        throw new ApiError(400, "ストア「" + name + "」のデータ形式が不正です(配列ではありません)");
      }
    });
  }

  // import_backup相当。全オブジェクトストアを対象に、バックアップに含まれる
  // ストアだけdbClear→dbPutし直す(バックアップに含まれないストア名は、
  // 古いバージョンのバックアップ等を想定し、既存データを変更せず残す)。
  async function importBackup(data) {
    _validateBackupPayload(data);

    var storeCounts = {};
    for (var i = 0; i < root.DB_STORE_NAMES.length; i++) {
      var name = root.DB_STORE_NAMES[i];
      var entries = data.stores[name];
      if (!Array.isArray(entries)) {
        continue;
      }
      await dbClear(name);
      var written = 0;
      for (var j = 0; j < entries.length; j++) {
        var entry = entries[j];
        if (!_isPlainObject(entry) || !Object.prototype.hasOwnProperty.call(entry, "key")) {
          continue; // 壊れた要素はスキップする(1件の不正でインポート全体を失敗させない)
        }
        await dbPut(name, entry.key, entry.value);
        written += 1;
      }
      storeCounts[name] = written;
    }
    return { store_counts: storeCounts };
  }

  root.exportBackup = exportBackup;
  root.importBackup = importBackup;

  // POST /backup/export — exportBackup()の結果をJSONファイルとしてダウンロードさせる。
  registerRoute("POST", "/backup/export", async function () {
    var data = await exportBackup();
    var json = JSON.stringify(data, null, 2);
    var filename = "jisseki-backup_" + _timestampForFilename() + ".json";
    if (typeof Blob !== "undefined" && typeof root.downloadWorkbook === "function") {
      var blob = new Blob([json], { type: "application/json" });
      root.downloadWorkbook(blob, filename);
    }
    var storeCounts = {};
    Object.keys(data.stores).forEach(function (name) {
      storeCounts[name] = data.stores[name].length;
    });
    return { filename: filename, store_counts: storeCounts };
  });

  // POST /backup/import — body(フロント側でFileReaderでJSON.parseした内容)を
  // 全ストアに書き戻す。
  registerRoute("POST", "/backup/import", async function (params, body) {
    return importBackup(body);
  });
})(typeof window !== "undefined" ? window : globalThis);
