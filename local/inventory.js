/**
 * local/inventory.js — 在庫管理(routers/inventory.pyの移植)。
 *
 * モジュールバンドラは使わない。<script src="local/inventory.js"> で読み込まれた
 * 時点で registerRoute を呼び、自分のルートを自己登録する(db.js → local-api.js →
 * local/store.js より後に読み込むこと — 本ファイルは window.checkStoreId を呼ぶ)。
 *
 * Node.js (tests/setup.js 経由の環境) でも
 * require("../db.js"); require("../local-api.js"); require("../local/store.js");
 * require("../local/inventory.js"); の順でrequireするだけで同じグローバル関数が
 * 使えるようにしてある。
 *
 * 移植元: JISSEKI_SRC/routers/inventory.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 * ロジックは忠実に移植し、変更した箇所はコードコメントに理由を明記する。
 *
 * ── データモデルの汎用化について(計画書Task8参照) ──────────────────────
 * Python版は「フレーバー」(シーシャの風味)専用の語彙だったが、データモデル
 * 自体は元から「商品名(name)+ブランド(brand)+在庫数(stock)+最低在庫数
 * (min_stock)」という汎用的な形だったため、バックエンド側(本ファイル)は
 * フィールド名も含めて無改修で移植する。買い手の業態に合わせた「フレーバー→
 * 商品」表記の簡略化・発注/人気タブの削除は frontend/inventory.js 側のみの
 * UI上の変更であり、保存データの構造(brand/min_stock等のフィールド名)は
 * 変えない(既存データ・ログとの互換性を保つため)。
 *
 * ── IndexedDBのキー設計について ──────────────────────────────────────
 * "inventory"ストア: store_idをキーに、商品オブジェクトの配列を値として
 * 保存する(inventory.jsonの`{store_id: [...]}`と1対1対応)。
 * "inventory_log"ストア: data_io.read_list/write(LOG_FILE)が単一ファイル内に
 * 全店舗分のログをlistとして持っていたのと同じく、固定キー("log")1本に
 * 全店舗分の配列をまとめて保存する(店舗ごとの直近1000件キャップ処理は
 * _appendLog内でPython版と同じロジックを再現する)。
 */
(function (root) {
  "use strict";

  var INVENTORY_STORE = "inventory";
  var LOG_STORE = "inventory_log";
  var LOG_KEY = "log";

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  // _int_or(inventory.py)の移植。bodyのキーが存在してもnullで送られた場合、
  // Number(null)=0相当で既定値を壊さないよう、null/undefinedの時だけ既定値に
  // フォールバックする。
  function _intOr(value, fallback) {
    if (value === null || value === undefined) {
      return fallback;
    }
    return parseInt(value, 10);
  }

  // add_flavor(inventory.py)内のID生成(re.sub)の移植。
  // 英数字・ひらがな・漢字(Unicode: 亜-熙)・カタカナ・長音符(ー)以外を
  // "_"に置換し、小文字化する。
  function _makeId(brand, name) {
    return (brand + "_" + name).replace(/[^a-zA-Z0-9ぁ-んァ-ヶ亜-熙ー]/g, "_").toLowerCase();
  }

  // _append_log(inventory.py)の移植。
  // dbGet→dbPutをdbUpdate()経由の直列化に変えている(audit-loop、2026-11-01の
  // 監査で発覚: 在庫画面で複数商品の±ボタンを素早く連続操作すると、全商品
  // 共通の全店舗分ログ1本("log"キー)への追記が後勝ちレースで消えうることを
  // 確認した)。
  async function _appendLog(entry) {
    await dbUpdate(LOG_STORE, LOG_KEY, async function (log) {
      log = log || [];
      log.push(entry);
      // 店舗ごとに直近1000件を保持する(全店舗合算キャップだと更新頻度の高い
      // 店舗が少ない店舗のログを押し出して消してしまうバグがあったための対策
      // ——Python版コメント参照。同じロジックを踏襲する)。
      var byStore = {};
      log.forEach(function (e) {
        var key = e && e.store_id;
        if (!byStore[key]) {
          byStore[key] = [];
        }
        byStore[key].push(e);
      });
      var trimmed = [];
      Object.keys(byStore).forEach(function (key) {
        trimmed = trimmed.concat(byStore[key].slice(-1000));
      });
      trimmed.sort(function (a, b) {
        var ta = (a && a.ts) || "";
        var tb = (b && b.ts) || "";
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return 0;
      });
      return trimmed;
    });
  }

  // get_inventory(inventory.py)の移植。
  // 店舗自体の実在はcheckStoreIdで判定し、在庫が未登録なだけの場合は
  // 空配列を返す(店舗作成直後に在庫画面を開くと誤って
  // 「store not found」になっていた旧事故の再発防止——Python版コメント参照)。
  async function getInventory(storeId) {
    await checkStoreId(storeId);
    var items = await dbGet(INVENTORY_STORE, storeId);
    return items === undefined ? [] : items;
  }

  // update_stock(inventory.py)の移植。body: { stock: 2 }
  //
  // dbGet→dbPutをdbUpdate()経由の直列化に変えている(audit-loop、2026-11-01の
  // 監査で発覚・再現シナリオあり: 在庫画面は商品ごとに+/-ボタンがあり、棚卸し中に
  // 違う商品のボタンを連打すると、前の変更を待たず次のPUTが発火する
  // [frontend/inventory.js::_setStockにデバウンス/キューが無い]。これが
  // 後勝ちレースを起こし、片方の商品の在庫変更が消えていた)。
  async function updateStock(storeId, flavorId, body) {
    // 2026-10-30バグハントで指摘(Critical): store_idの検証が無かった
    // (他の書き込み系と同種の穴)。
    await checkStoreId(storeId);

    var oldStock, newStock, target;
    await dbUpdate(INVENTORY_STORE, storeId, async function (items) {
      if (items === undefined) {
        throw new ApiError(404, "store not found");
      }
      target = items.find(function (f) {
        return f && f.id === flavorId;
      });
      if (!target) {
        throw new ApiError(404, "flavor not found");
      }
      oldStock = target.stock;
      newStock = Math.max(0, _intOr(body && body.stock, target.stock));
      target.stock = newStock;
      return items;
    });

    if (oldStock !== newStock) {
      await _appendLog({
        ts: new Date().toISOString().slice(0, 19),
        store_id: storeId,
        flavor_id: flavorId,
        brand: target.brand || "",
        name: target.name || "",
        from_stock: oldStock,
        to_stock: newStock,
      });
    }

    return { ok: true, stock: newStock };
  }

  // add_flavor(inventory.py)の移植。
  async function addFlavor(storeId, body) {
    // 2026-10-30バグハントで指摘(Critical): store_idの検証が無く、任意の
    // store_idでinventoryストアに恒久的なゴミキーが作られうる唯一の経路だった
    // (update_stock/delete_flavorは既存キーへのmembershipチェックで404に
    // なっていたが、ここだけ無条件に新規作成していた)。
    await checkStoreId(storeId);
    var name = ((body && body.name) || "").trim();
    var brand = ((body && body.brand) || "その他").trim();
    if (!name) {
      throw new ApiError(400, "name required");
    }
    var fid = _makeId(brand, name);

    await dbUpdate(INVENTORY_STORE, storeId, async function (items) {
      if (items === undefined) {
        items = [];
      }
      var dup = items.some(function (f) {
        return f && f.id === fid;
      });
      if (dup) {
        throw new ApiError(409, "already exists");
      }
      items.push({
        id: fid,
        brand: brand,
        name: name,
        stock: _intOr(body && body.stock, 0),
        min_stock: _intOr(body && body.min_stock, 1),
      });
      return items;
    });
    return { ok: true, id: fid };
  }

  // delete_flavor(inventory.py)の移植。
  async function deleteFlavor(storeId, flavorId) {
    await checkStoreId(storeId);
    await dbUpdate(INVENTORY_STORE, storeId, async function (items) {
      if (items === undefined) {
        throw new ApiError(404, "store not found");
      }
      var before = items.length;
      var filtered = items.filter(function (f) {
        return !(f && f.id === flavorId);
      });
      if (filtered.length === before) {
        throw new ApiError(404, "flavor not found");
      }
      return filtered;
    });
    return { ok: true };
  }

  // get_log(inventory.py)の移植。GET /inventory/{store_id}/log/recent?limit=100
  async function getLog(storeId, limit) {
    // python版は `limit: int = 100` (未指定なら100)。クエリ文字列経由だと
    // paramsの値は常に文字列なので、ここで数値化する(未指定/NaNは100)。
    var parsedLimit = limit === undefined || limit === null || limit === "" ? 100 : parseInt(limit, 10);
    if (Number.isNaN(parsedLimit)) {
      parsedLimit = 100;
    }
    if (parsedLimit <= 0) {
      // filtered.slice(-0) はJSでも「全件」(0は特別扱いされない空スライスにならない)
      // ため、Python版の `filtered[-limit:]` と同じ事故(limit=0で全件返る)を
      // 防ぐため明示的に空配列を返す(Python版コメント参照)。
      return [];
    }
    var log = (await dbGet(LOG_STORE, LOG_KEY)) || [];
    var filtered = log.filter(function (e) {
      return e && e.store_id === storeId;
    });
    return filtered.slice(-parsedLimit).reverse();
  }

  root.getInventory = getInventory;
  root.updateStock = updateStock;
  root.addFlavor = addFlavor;
  root.deleteFlavor = deleteFlavor;
  root.getLog = getLog;

  registerRoute("GET", "/inventory/:store_id", function (params) {
    return getInventory(params.store_id);
  });
  registerRoute("PUT", "/inventory/:store_id/:flavor_id", function (params, body) {
    return updateStock(params.store_id, params.flavor_id, body);
  });
  registerRoute("POST", "/inventory/:store_id/flavor", function (params, body) {
    return addFlavor(params.store_id, body);
  });
  registerRoute("DELETE", "/inventory/:store_id/:flavor_id", function (params) {
    return deleteFlavor(params.store_id, params.flavor_id);
  });
  registerRoute("GET", "/inventory/:store_id/log/recent", function (params) {
    return getLog(params.store_id, params.limit);
  });
})(typeof window !== "undefined" ? window : globalThis);
