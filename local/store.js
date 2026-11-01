/**
 * local/store.js — 店舗CRUD(store.pyの移植)。
 *
 * モジュールバンドラは使わない。<script src="local/store.js"> で読み込まれた
 * 時点で registerRoute を呼び、自分のルートを自己登録する(db.js・local-api.js
 * より後、local/staff.js より前に読み込むこと — staff.js は window.checkStoreId
 * を呼び出す)。
 *
 * Node.js (tests/setup.js 経由の環境) でも
 * require("../db.js"); require("../local-api.js"); require("../local/store.js");
 * の順でrequireするだけで同じグローバル関数が使えるようにしてある。
 *
 * 移植元: JISSEKI_SRC/routers/store.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 * ロジックは忠実に移植し、変更した箇所はコードコメントに理由を明記する。
 */
(function (root) {
  "use strict";

  var STORES_STORE = "stores";
  var STAFF_STORE = "staff";
  var DAILY_STORE = "daily";

  // Pythonの真偽判定(空dict/空listはfalsy)をJSで再現する。
  // store.pyのdelete_storeは `day[store_id]` が空dict({})の場合は
  // falsyとして削除を許可する(JSの{}は常にtruthyなので、ここを素朴に
  // `if (day[storeId])` と書くと挙動が変わってしまう)。
  function _isPythonTruthy(v) {
    if (v === null || v === undefined || v === false || v === 0 || v === "") {
      return false;
    }
    if (Array.isArray(v)) {
      return v.length > 0;
    }
    if (typeof v === "object") {
      return Object.keys(v).length > 0;
    }
    return true;
  }

  function _assertNotCorrupted(store) {
    // store.pyの `if not isinstance(stores[store_id], dict)` 相当のガード。
    // IndexedDB側では基本的に発生しない状態だが、忠実な移植として残す。
    if (typeof store !== "object" || store === null || Array.isArray(store)) {
      throw new ApiError(500, "store data is corrupted");
    }
  }

  // check_store_id(store.py)の移植。
  // "stores"ストアに実在するstore_idかどうかを判定する(staff.js等から使う)。
  async function checkStoreId(storeId) {
    var store = await dbGet(STORES_STORE, storeId);
    if (store === undefined) {
      throw new ApiError(400, "store_id '" + storeId + "' は登録されていません。");
    }
  }

  // get_stores(store.py)の移植。
  // IndexedDBの"stores"はstore_idをキーに個別保存されているため、
  // stores.jsonと同じ { store_id: storeObj } 形(dict)に組み立てて返す
  // (frontend/app.js等がObject.keys(stores)・stores[id]で使う前提に合わせる)。
  async function getStores() {
    var all = await dbGetAll(STORES_STORE);
    var result = {};
    all.forEach(function (s) {
      if (s && typeof s === "object" && s.id) {
        result[s.id] = s;
      }
    });
    return result;
  }

  // get_store(store.py)の移植。
  async function getStore(storeId) {
    var store = await dbGet(STORES_STORE, storeId);
    if (store === undefined) {
      throw new ApiError(404, "store not found");
    }
    return store;
  }

  // update_store(store.py)の移植。dict.update相当の部分更新(浅いマージ)。
  //
  // dbGet→dbPutをdbUpdate()経由の直列化に変えている(audit-loop、2026-11-01の
  // 監査で発覚: 定休日チェックボックスのような、同じ店舗レコードを連続編集する
  // UI操作がそのまま後勝ちレースを引き起こし、先の変更が消えることを確認した。
  // local/settings.jsで実際に発生した事故と同じ原因・同じ直し方)。
  async function updateStore(storeId, body) {
    return dbUpdate(STORES_STORE, storeId, async function (store) {
      if (store === undefined) {
        throw new ApiError(404, "store not found");
      }
      _assertNotCorrupted(store);
      Object.assign(store, body || {});
      return store;
    });
  }

  // update_champagne(store.py)の移植。
  async function updateChampagne(storeId, champId, body) {
    var updatedStore = await dbUpdate(STORES_STORE, storeId, async function (store) {
      if (store === undefined) {
        throw new ApiError(404, "store not found");
      }
      _assertNotCorrupted(store);
      var menu = store.champagne_menu || [];
      var item = menu.find(function (c) {
        return c && typeof c === "object" && c.id === champId;
      });
      if (!item) {
        throw new ApiError(404, "champagne not found");
      }
      if (body && body.name !== undefined && body.name !== null) {
        item.name = body.name;
      }
      if (body && body.price !== undefined && body.price !== null) {
        item.price = body.price;
      }
      return store;
    });
    return updatedStore.champagne_menu.find(function (c) {
      return c && typeof c === "object" && c.id === champId;
    });
  }

  // add_champagne(store.py)の移植。
  async function addChampagne(storeId, body) {
    return dbUpdate(STORES_STORE, storeId, async function (store) {
      if (store === undefined) {
        throw new ApiError(404, "store not found");
      }
      _assertNotCorrupted(store);
      if (!body || !body.id || !body.name) {
        throw new ApiError(400, "id and name are required");
      }
      if (!store.champagne_menu) {
        store.champagne_menu = [];
      }
      var menu = store.champagne_menu;
      // 2026-09-27発見の重複id事故(update_champagne/delete_champagneが
      // next()相当で先頭の1件しかヒットせず2件目が操作不能になる)の再発防止。
      var dup = menu.some(function (c) {
        return c && typeof c === "object" && c.id === body.id;
      });
      if (dup) {
        throw new ApiError(400, "id '" + body.id + "' は既に使用されています");
      }
      menu.push(body);
      return store;
    }).then(function () {
      return body;
    });
  }

  // delete_champagne(store.py)の移植。
  async function deleteChampagne(storeId, champId) {
    await dbUpdate(STORES_STORE, storeId, async function (store) {
      if (store === undefined) {
        throw new ApiError(404, "store not found");
      }
      _assertNotCorrupted(store);
      store.champagne_menu = (store.champagne_menu || []).filter(function (c) {
        return !(c && typeof c === "object" && c.id === champId);
      });
      return store;
    });
    return { ok: true };
  }

  // create_store(store.py)の移植。
  async function createStore(body) {
    var storeId = ((body && body.id) || "").trim();
    var name = ((body && body.name) || "").trim();
    if (!storeId) {
      throw new ApiError(400, "id is required");
    }
    if (!name) {
      throw new ApiError(400, "name is required");
    }
    var existing = await dbGet(STORES_STORE, storeId);
    if (existing !== undefined) {
      throw new ApiError(400, "store_id '" + storeId + "' は既に使用されています");
    }
    var newStore = {
      id: storeId,
      name: name,
      regular_closed_days: (body && body.regular_closed_days) || [],
      champagne_menu: (body && body.champagne_menu) || [],
    };
    await dbPut(STORES_STORE, storeId, newStore);
    return newStore;
  }

  // delete_store(store.py)の移植。
  // アクティブなスタッフが残っている、またはdaily実績データが残っている場合は
  // 409相当のApiErrorを投げて削除を拒否する(参照ガード)。
  //
  // 注: "daily"ストアのキー構造はTask4(local/daily.js)でまだ正式に実装されて
  // いない。store.pyのdelete_storeは data_io.all_daily_filenames()
  // (= daily_YYYY.jsonの全年ファイル)を横断的に読み、各ファイルを
  // { date: { store_id: dayData } } の形として走査する。IndexedDBの"daily"
  // ストアもこれと1対1対応する構造(年をキーに { date: { store_id: dayData } }
  // を値として保存)になる前提でこの関数を書いている。Task4実装時にこの前提と
  // 食い違う場合は本関数も合わせて更新すること。
  async function deleteStore(storeId) {
    var store = await dbGet(STORES_STORE, storeId);
    if (store === undefined) {
      throw new ApiError(404, "store not found");
    }

    var staffList = await dbGetAll(STAFF_STORE);
    var hasActiveStaff = staffList.some(function (s) {
      return s && typeof s === "object" && s.store_id === storeId && s.active;
    });
    if (hasActiveStaff) {
      throw new ApiError(
        409,
        "この店舗に所属するスタッフが残っているため削除できません。先にスタッフを削除または他店舗へ移動してください。"
      );
    }

    var dailyYears = await dbGetAll(DAILY_STORE);
    for (var i = 0; i < dailyYears.length; i++) {
      var yearData = dailyYears[i];
      if (!yearData || typeof yearData !== "object") {
        continue;
      }
      var dates = Object.keys(yearData);
      for (var j = 0; j < dates.length; j++) {
        var day = yearData[dates[j]];
        if (day && typeof day === "object" && _isPythonTruthy(day[storeId])) {
          throw new ApiError(409, "この店舗の実績データが残っているため削除できません。");
        }
      }
    }

    await dbDelete(STORES_STORE, storeId);
    return { ok: true };
  }

  root.checkStoreId = checkStoreId;
  root.getStores = getStores;
  root.getStore = getStore;
  root.updateStore = updateStore;
  root.updateChampagne = updateChampagne;
  root.addChampagne = addChampagne;
  root.deleteChampagne = deleteChampagne;
  root.createStore = createStore;
  root.deleteStore = deleteStore;

  registerRoute("GET", "/stores", function () {
    return getStores();
  });
  registerRoute("GET", "/stores/:store_id", function (params) {
    return getStore(params.store_id);
  });
  registerRoute("PUT", "/stores/:store_id", function (params, body) {
    return updateStore(params.store_id, body);
  });
  registerRoute("PUT", "/stores/:store_id/champagne/:champ_id", function (params, body) {
    return updateChampagne(params.store_id, params.champ_id, body);
  });
  registerRoute("POST", "/stores/:store_id/champagne", function (params, body) {
    return addChampagne(params.store_id, body);
  });
  registerRoute("DELETE", "/stores/:store_id/champagne/:champ_id", function (params) {
    return deleteChampagne(params.store_id, params.champ_id);
  });
  registerRoute("POST", "/stores", function (params, body) {
    return createStore(body);
  });
  registerRoute("DELETE", "/stores/:store_id", function (params) {
    return deleteStore(params.store_id);
  });
})(typeof window !== "undefined" ? window : globalThis);
