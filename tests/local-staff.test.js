"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/store.js");
require("../local/staff.js");

// テスト用の店舗を1つ作っておく(store_idバリデーションを通すため)。
async function ensureStore(storeId) {
  await createStore({ id: storeId, name: storeId + "店" }).catch(() => {});
}

test("createStaff: 正常に作成できる", async () => {
  await ensureStore("st-a");
  const staff = await createStaff({
    id: "staff-a1",
    name: "山田",
    store_id: "st-a",
    pay_type: "hourly",
  });
  assert.strictEqual(staff.name, "山田");
  const fetched = await getOneStaff("staff-a1");
  assert.strictEqual(fetched.store_id, "st-a");
});

test("createStaff: idが無ければ400", async () => {
  await ensureStore("st-b");
  await assert.rejects(
    async () => createStaff({ name: "no id", store_id: "st-b", pay_type: "hourly" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /id required/);
      return true;
    }
  );
});

test("createStaff: idが重複していれば400", async () => {
  await ensureStore("st-c");
  await createStaff({ id: "staff-c1", name: "A", store_id: "st-c", pay_type: "hourly" });
  await assert.rejects(
    async () => createStaff({ id: "staff-c1", name: "B", store_id: "st-c", pay_type: "hourly" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /unique/);
      return true;
    }
  );
});

test("createStaff: nameが無ければ400", async () => {
  await ensureStore("st-d");
  await assert.rejects(
    async () => createStaff({ id: "staff-d1", store_id: "st-d", pay_type: "hourly" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /name is required/);
      return true;
    }
  );
});

test("createStaff: store_idが無ければ400", async () => {
  await assert.rejects(
    async () => createStaff({ id: "staff-e1", name: "E", pay_type: "hourly" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /store_id is required/);
      return true;
    }
  );
});

test("createStaff: 存在しないstore_idは400(2026-10-30バグハント指摘のガード)", async () => {
  await assert.rejects(
    async () =>
      createStaff({ id: "staff-f1", name: "F", store_id: "no-such-store", pay_type: "hourly" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /登録されていません/);
      return true;
    }
  );
});

test("createStaff: pay_typeがhourly/monthly以外は400", async () => {
  await ensureStore("st-g");
  await assert.rejects(
    async () =>
      createStaff({ id: "staff-g1", name: "G", store_id: "st-g", pay_type: "daily" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /pay_type/);
      return true;
    }
  );
});

test("getStaff: store_id指定で絞り込める", async () => {
  await ensureStore("st-h1");
  await ensureStore("st-h2");
  await createStaff({ id: "staff-h1", name: "H1", store_id: "st-h1", pay_type: "hourly" });
  await createStaff({ id: "staff-h2", name: "H2", store_id: "st-h2", pay_type: "hourly" });

  const all = await getStaff();
  assert.ok(all.some((s) => s.id === "staff-h1"));
  assert.ok(all.some((s) => s.id === "staff-h2"));

  const onlyH1 = await getStaff("st-h1");
  assert.ok(onlyH1.every((s) => s.store_id === "st-h1"));
  assert.ok(onlyH1.some((s) => s.id === "staff-h1"));
});

test("getStaff: store_id=null(両店舗兼務)はフィルタ無し取得で含まれる", async () => {
  // create_staffはstore_id必須(Pythonの `not body.get("store_id")` は
  // Noneも含めて拒否するため、store_id=nullは作成時には使えない)。
  // 両店舗兼務は作成後にupdate_staffでstore_id=nullへ変更する運用。
  await ensureStore("st-owner");
  await createStaff({ id: "staff-owner", name: "オーナー", store_id: "st-owner", pay_type: "monthly" });
  await updateStaff("staff-owner", { store_id: null });

  const all = await getStaff();
  const owner = all.find((s) => s.id === "staff-owner");
  assert.ok(owner);
  assert.strictEqual(owner.store_id, null);
});

test("getOneStaff: 存在しなければ404", async () => {
  await assert.rejects(async () => getOneStaff("no-such-staff"), (err) => {
    assert.strictEqual(err.status, 404);
    return true;
  });
});

test("updateStaff: idフィールドは無視され、キー(staff_id)は変わらない", async () => {
  await ensureStore("st-i");
  await createStaff({ id: "staff-i1", name: "I1", store_id: "st-i", pay_type: "hourly" });
  const updated = await updateStaff("staff-i1", { id: "staff-i1-changed", name: "I1改名" });
  assert.strictEqual(updated.name, "I1改名");
  assert.strictEqual(updated.id, "staff-i1"); // idは書き換わらない

  const fetched = await getOneStaff("staff-i1");
  assert.strictEqual(fetched.name, "I1改名");
  await assert.rejects(async () => getOneStaff("staff-i1-changed"), (err) => {
    assert.strictEqual(err.status, 404);
    return true;
  });
});

test("updateStaff: 存在しないstaff_idは404", async () => {
  await assert.rejects(async () => updateStaff("no-such-staff", { name: "x" }), (err) => {
    assert.strictEqual(err.status, 404);
    return true;
  });
});

test("updateStaff: store_id=nullは許容される(両店舗兼務)", async () => {
  await ensureStore("st-j");
  await createStaff({ id: "staff-j1", name: "J1", store_id: "st-j", pay_type: "hourly" });
  const updated = await updateStaff("staff-j1", { store_id: null });
  assert.strictEqual(updated.store_id, null);
});

test("updateStaff: 存在しないstore_idへの変更は400", async () => {
  await ensureStore("st-k");
  await createStaff({ id: "staff-k1", name: "K1", store_id: "st-k", pay_type: "hourly" });
  await assert.rejects(
    async () => updateStaff("staff-k1", { store_id: "no-such-store" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      return true;
    }
  );
});

test("updateStaff: _NON_NEGATIVE_FIELDSが負数だと400", async () => {
  await ensureStore("st-l");
  await createStaff({ id: "staff-l1", name: "L1", store_id: "st-l", pay_type: "hourly" });
  for (const field of [
    "hourly_rate",
    "monthly_salary",
    "transport_one_way",
    "absence_base_salary",
  ]) {
    await assert.rejects(
      async () => updateStaff("staff-l1", { [field]: -1 }),
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.match(err.message, new RegExp(field + " must not be negative"));
        return true;
      },
      `field=${field}`
    );
  }
});

test("updateStaff: _NON_NEGATIVE_FIELDSがnullなら許容される(クリア目的)", async () => {
  await ensureStore("st-m");
  await createStaff({ id: "staff-m1", name: "M1", store_id: "st-m", pay_type: "hourly" });
  const updated = await updateStaff("staff-m1", { hourly_rate: null });
  assert.strictEqual(updated.hourly_rate, null);
});

test("updateStaff: 部分更新(dict.update相当)で既存フィールドを保持する", async () => {
  await ensureStore("st-n");
  await createStaff({
    id: "staff-n1",
    name: "N1",
    store_id: "st-n",
    pay_type: "hourly",
    hourly_rate: 1000,
  });
  const updated = await updateStaff("staff-n1", { name: "N1改" });
  assert.strictEqual(updated.name, "N1改");
  assert.strictEqual(updated.hourly_rate, 1000);
});

test("updateStaff: rate_historyの既存エントリはロック判定をスキップする(false positive対策)", async () => {
  await ensureStore("st-o");
  await createStaff({
    id: "staff-o1",
    name: "O1",
    store_id: "st-o",
    pay_type: "hourly",
    rate_history: [{ from: "2026-06-01", rate: 1000 }],
  });

  global.isLocked = (y, m) => y === 2026 && m === 6;
  try {
    // 既存と完全一致するエントリのみを含む置換 -> ロック判定されない。
    const updated = await updateStaff("staff-o1", {
      rate_history: [{ from: "2026-06-01", rate: 1000 }],
    });
    assert.deepStrictEqual(updated.rate_history, [{ from: "2026-06-01", rate: 1000 }]);
  } finally {
    delete global.isLocked;
  }
});

test("updateStaff: rate_historyに新規追加されたロック済み月のエントリがあると423", async () => {
  await ensureStore("st-p");
  await createStaff({
    id: "staff-p1",
    name: "P1",
    store_id: "st-p",
    pay_type: "hourly",
    rate_history: [],
  });

  global.isLocked = (y, m) => y === 2026 && m === 6;
  try {
    await assert.rejects(
      async () =>
        updateStaff("staff-p1", {
          rate_history: [{ from: "2026-06-01", rate: 1200 }],
        }),
      (err) => {
        assert.strictEqual(err.status, 423);
        assert.match(err.message, /給与確定済み/);
        return true;
      }
    );
  } finally {
    delete global.isLocked;
  }
});

test("updateStaff: isLockedが未定義(Task6未実装)の間はrate_history変更を常に許可する", async () => {
  await ensureStore("st-q");
  await createStaff({
    id: "staff-q1",
    name: "Q1",
    store_id: "st-q",
    pay_type: "hourly",
    rate_history: [],
  });

  assert.strictEqual(typeof global.isLocked, "undefined");
  const updated = await updateStaff("staff-q1", {
    rate_history: [{ from: "2026-06-01", rate: 1200 }],
  });
  assert.deepStrictEqual(updated.rate_history, [{ from: "2026-06-01", rate: 1200 }]);
});

test("deleteStaff: ソフト削除(active=falseになるだけで取得は可能)", async () => {
  await ensureStore("st-r");
  await createStaff({
    id: "staff-r1",
    name: "R1",
    store_id: "st-r",
    pay_type: "hourly",
    active: true,
  });

  const result = await deleteStaff("staff-r1");
  assert.deepStrictEqual(result, { ok: true });

  const fetched = await getOneStaff("staff-r1");
  assert.strictEqual(fetched.active, false);
  assert.strictEqual(fetched.name, "R1");
});

test("deleteStaff: 存在しないstaff_idは404", async () => {
  await assert.rejects(async () => deleteStaff("no-such-staff"), (err) => {
    assert.strictEqual(err.status, 404);
    return true;
  });
});

test("localApiCall経由でのルーティング: GET/POST/PUT/DELETE /staff", async () => {
  await ensureStore("st-route");
  const created = await localApiCall("POST", "/staff", {
    id: "staff-route1",
    name: "Route子",
    store_id: "st-route",
    pay_type: "hourly",
  });
  assert.strictEqual(created.name, "Route子");

  const fetched = await localApiCall("GET", "/staff/staff-route1");
  assert.strictEqual(fetched.name, "Route子");

  const updated = await localApiCall("PUT", "/staff/staff-route1", { name: "Route子2" });
  assert.strictEqual(updated.name, "Route子2");

  const list = await localApiCall("GET", "/staff?store_id=st-route");
  assert.ok(list.some((s) => s.id === "staff-route1"));

  const deleted = await localApiCall("DELETE", "/staff/staff-route1");
  assert.deepStrictEqual(deleted, { ok: true });

  const afterDelete = await localApiCall("GET", "/staff/staff-route1");
  assert.strictEqual(afterDelete.active, false);
});
