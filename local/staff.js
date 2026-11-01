/**
 * local/staff.js — スタッフCRUD(staff.pyの移植)。
 *
 * 依存: local/store.js(window.checkStoreId)。<script>タグは
 * db.js → local-api.js → local/store.js → local/staff.js の順で読み込むこと。
 *
 * 移植元: JISSEKI_SRC/routers/staff.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 *
 * 計画書(Task3)の移植対象外(今回は意図的に移植しない):
 * - `GET /staff/stale-refs` (get_stale_staff_refs): daily(Task4)側のデータに
 *   依存する独立した整合性チェックエンドポイントで、Task3の移植対象一覧
 *   (GET/POST/PUT/DELETE /staff)に含まれていない。Task4実装後に必要なら
 *   別タスクで追加する。
 * - rate_history更新時のpayroll_admin.is_lockedとの連携: is_lockedは
 *   Task6(local/payroll-admin.js)で実装される。本ファイルはロジックの形
 *   (ロック済み月への新規時給改定を423相当で拒否する)自体は移植してあるが、
 *   実際のロック判定は window.isLocked が定義されていれば呼ぶ遅延バインディング
 *   にしてある(未定義の間は常に「ロックされていない」扱い = 現状と同じ
 *   無条件許可のまま)。Task6実装後、本ファイルを変更せずにロックチェックが
 *   有効になる。
 */
(function (root) {
  "use strict";

  var STAFF_STORE = "staff";

  var NON_NEGATIVE_FIELDS = [
    "hourly_rate",
    "monthly_salary",
    "transport_one_way",
    "absence_base_salary",
  ];

  function _assertNotCorrupted(staff) {
    if (typeof staff !== "object" || staff === null || Array.isArray(staff)) {
      throw new ApiError(500, "staff data is corrupted");
    }
  }

  // Task6(payroll-admin.js)が window.isLocked(year, month) を定義するまでは
  // 常にfalse(ロック無し)を返す。詳細はファイル先頭のコメント参照。
  function _isLocked(year, month) {
    if (typeof root.isLocked === "function") {
      return root.isLocked(year, month);
    }
    return false;
  }

  // get_staff(staff.py)の移植。
  async function getStaff(storeId) {
    var all = await dbGetAll(STAFF_STORE);
    var result = all.filter(function (s) {
      return s && typeof s === "object";
    });
    if (storeId) {
      result = result.filter(function (s) {
        return s.store_id === storeId;
      });
    }
    return result;
  }

  // get_one(staff.py)の移植。
  async function getOneStaff(staffId) {
    var staff = await dbGet(STAFF_STORE, staffId);
    if (staff === undefined) {
      throw new ApiError(404, "staff not found");
    }
    return staff;
  }

  // create_staff(staff.py)の移植。
  async function createStaff(body) {
    var sid = body && body.id;
    var existing = sid ? await dbGet(STAFF_STORE, sid) : undefined;
    if (!sid || existing !== undefined) {
      throw new ApiError(400, "id required and must be unique");
    }
    if (!body.name) {
      throw new ApiError(400, "name is required");
    }
    if (!body.store_id) {
      throw new ApiError(400, "store_id is required");
    }
    // 2026-10-30バグハントで指摘(Critical): store_idが「空でない」ことしか
    // 検証しておらず、存在しない店舗名で恒久的なゴミスタッフが作成できた
    // (staff.py参照)。
    await checkStoreId(body.store_id);
    if (body.pay_type !== "hourly" && body.pay_type !== "monthly") {
      throw new ApiError(400, "pay_type must be 'hourly' or 'monthly'");
    }
    await dbPut(STAFF_STORE, sid, body);
    return body;
  }

  // update_staff(staff.py)の移植。
  async function updateStaff(staffId, body) {
    // idフィールドは辞書のキー(staff_id)と常に一致していなければならない。
    // 書き換え可能にすると、以後フロントがs.id(=書き換え後の値)でPUT/DELETEを
    // 呼ぶようになり、そのスタッフのレコードが404で操作不能になる事故が起きる
    // (2026-08-06確認、staff.py参照)。
    var cleanBody = {};
    Object.keys(body || {}).forEach(function (k) {
      if (k !== "id") {
        cleanBody[k] = body[k];
      }
    });

    // 2026-10-30バグハントで指摘(Critical): 同上(create_staff参照)。
    // オーナーはstore_id=null(両店舗兼務)が正当な状態のため、nullはそのまま許容する。
    if ("store_id" in cleanBody && cleanBody.store_id !== null) {
      await checkStoreId(cleanBody.store_id);
    }

    for (var i = 0; i < NON_NEGATIVE_FIELDS.length; i++) {
      var f = NON_NEGATIVE_FIELDS[i];
      if (
        f in cleanBody &&
        cleanBody[f] !== null &&
        cleanBody[f] !== undefined &&
        cleanBody[f] < 0
      ) {
        throw new ApiError(400, f + " must not be negative");
      }
    }

    // dbGet→dbPutをdbUpdate()経由の直列化に変えている(audit-loop、2026-11-01の
    // 監査で発覚: 同一スタッフの複数フィールドを連続編集するUI操作[例: 名前欄→
    // 時給欄とTabで移動]が後勝ちレースを起こし、片方の変更が消えうることを
    // 確認した。local/settings.jsで実際に発生した事故と同じ原因・同じ直し方)。
    return dbUpdate(STAFF_STORE, staffId, async function (staff) {
      if (staff === undefined) {
        throw new ApiError(404, "staff not found");
      }
      _assertNotCorrupted(staff);

      if ("rate_history" in cleanBody && Array.isArray(cleanBody.rate_history)) {
        // rate_historyは全体置換のため、送信された配列に既存のロック済み月の
        // 履歴(変更なし)が1件でも含まれているだけで全体を拒否すると、一度でも
        // 時給改定した月がロックされた全スタッフが今後永久に新しい時給改定を
        // 登録できなくなる(2026-08-06のレビューで発見したfalse positive)。
        // 既存と完全一致するエントリは対象外にし、新規追加・変更されたエントリ
        // だけをロック判定する(staff.py参照)。
        var existingRh = staff.rate_history || [];
        var newRh = cleanBody.rate_history;

        var sigOf = function (e) {
          return e.from + "|" + e.rate;
        };
        var newSet = new Set(
          newRh.filter(function (e) { return e && typeof e === "object"; }).map(sigOf)
        );
        var existingSet = new Set(
          existingRh.filter(function (e) { return e && typeof e === "object"; }).map(sigOf)
        );

        var checkLockForFrom = function (from) {
          if (from && from.length >= 7) {
            var y = parseInt(from.slice(0, 4), 10);
            var m = parseInt(from.slice(5, 7), 10);
            if (!Number.isNaN(y) && !Number.isNaN(m) && _isLocked(y, m)) {
              throw new ApiError(
                423,
                y + "年" + m + "月は給与確定済みのため、この月の時給改定は変更できません"
              );
            }
          }
        };

        for (var j = 0; j < newRh.length; j++) {
          var rh = newRh[j];
          if (!rh || typeof rh !== "object") {
            continue;
          }
          if (existingSet.has(sigOf(rh))) {
            continue; // 既存のまま変更されていないエントリはロック判定しない
          }
          checkLockForFrom(rh.from || "");
        }

        // audit-loop(2026-11-01)で発見・実際に再現確認済み(Critical):
        // 上のループは新しい配列に残っているエントリしか見ておらず、
        // ロック済み月の既存エントリを配列から単純に取り除く(削除する)操作は
        // ノーチェックで通ってしまい423を回避できた。削除すると、その月以降の
        // 未ロック月の実効時給がstaff.hourly_rateへ静かに戻ってしまう実害が
        // あるため、既存にあって新しい配列に無い(=削除された)エントリも
        // 同様にロック判定する。
        for (var k = 0; k < existingRh.length; k++) {
          var old = existingRh[k];
          if (!old || typeof old !== "object") {
            continue;
          }
          if (newSet.has(sigOf(old))) {
            continue; // 残っている(削除されていない)
          }
          checkLockForFrom(old.from || "");
        }
      }

      Object.assign(staff, cleanBody);
      return staff;
    });
  }

  // delete_staff(staff.py)の移植。ソフト削除(active=falseにするだけで削除しない)。
  // これは意図的な仕様: 過去の実績データ(daily.staff_entries)がstaff_idを
  // 参照し続けるため、実削除すると過去月の表示・給与計算が参照切れになる
  // (staff.py参照)。
  async function deleteStaff(staffId) {
    await dbUpdate(STAFF_STORE, staffId, async function (staff) {
      if (staff === undefined) {
        throw new ApiError(404, "staff not found");
      }
      _assertNotCorrupted(staff);
      staff.active = false;
      return staff;
    });
    return { ok: true };
  }

  root.getStaff = getStaff;
  root.getOneStaff = getOneStaff;
  root.createStaff = createStaff;
  root.updateStaff = updateStaff;
  root.deleteStaff = deleteStaff;

  registerRoute("GET", "/staff", function (params) {
    return getStaff(params && params.store_id);
  });
  registerRoute("GET", "/staff/:staff_id", function (params) {
    return getOneStaff(params.staff_id);
  });
  registerRoute("POST", "/staff", function (params, body) {
    return createStaff(body);
  });
  registerRoute("PUT", "/staff/:staff_id", function (params, body) {
    return updateStaff(params.staff_id, body);
  });
  registerRoute("DELETE", "/staff/:staff_id", function (params) {
    return deleteStaff(params.staff_id);
  });
})(typeof window !== "undefined" ? window : globalThis);
