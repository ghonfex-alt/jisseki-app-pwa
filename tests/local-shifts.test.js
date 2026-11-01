"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/store.js");
require("../local/staff.js");
require("../local/daily.js");
require("../local/tax-table-r8.js");
require("../local/payroll.js");
require("../local/payroll-admin.js");
require("../local/shifts.js");

async function ensureStore(storeId) {
  await createStore({ id: storeId, name: storeId + "店" }).catch(() => {});
}

async function cleanupLock(year, month) {
  await unlockMonth(year, month).catch(() => {});
}

// 常に過去日になるよう固定日付を使う(getShiftGapsは未来日をスキップするため)。
const PAST_YEAR = 2020;

// ─────────────────────────────────────────────────────────────────────
// putShifts / getShifts
// ─────────────────────────────────────────────────────────────────────
test("putShifts → getShifts: 保存した内容がそのまま読める", async () => {
  await ensureStore("sh-a");
  await putShifts(2026, 1, "sh-a", { "2026-01-05": ["s1", "s2"], "2026-01-06": null });
  const data = await getShifts(2026, 1);
  assert.deepStrictEqual(data["sh-a"], { "2026-01-05": ["s1", "s2"], "2026-01-06": null });
});

test("getShifts: 何も保存していない年月は空dict", async () => {
  const data = await getShifts(2099, 12);
  assert.deepStrictEqual(data, {});
});

test("putShifts: 存在しないstore_idは400", async () => {
  await assert.rejects(
    async () => putShifts(2026, 1, "sh-nonexistent", { "2026-01-01": ["s1"] }),
    (err) => {
      assert.strictEqual(err.status, 400);
      return true;
    }
  );
});

test("putShifts: ロック済み月は423", async () => {
  await ensureStore("sh-b");
  try {
    await lockMonth(2026, 2);
    await assert.rejects(
      async () => putShifts(2026, 2, "sh-b", { "2026-02-01": ["s1"] }),
      (err) => {
        assert.strictEqual(err.status, 423);
        assert.match(err.message, /給与確定済み/);
        return true;
      }
    );
  } finally {
    await cleanupLock(2026, 2);
  }
});

// ─────────────────────────────────────────────────────────────────────
// putRequests / getShifts(合成, "_req_"互換)
// ─────────────────────────────────────────────────────────────────────
test("putRequests: getShiftsのレスポンスに\"_req_\"+store_idとして合成される(旧フロント互換)", async () => {
  await ensureStore("sh-c");
  await putRequests(2026, 3, "sh-c", { s1: { want: ["2026-03-01"], ng: [] } });
  const data = await getShifts(2026, 3);
  assert.deepStrictEqual(data["_req_sh-c"], { s1: { want: ["2026-03-01"], ng: [] } });
});

test("putRequests: 存在しないstore_idは400、ロック済み月は423", async () => {
  await assert.rejects(async () => putRequests(2026, 4, "sh-nonexistent", {}), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });

  await ensureStore("sh-d");
  try {
    await lockMonth(2026, 4);
    await assert.rejects(async () => putRequests(2026, 4, "sh-d", {}), (err) => {
      assert.strictEqual(err.status, 423);
      return true;
    });
  } finally {
    await cleanupLock(2026, 4);
  }
});

test("putShifts/putRequestsは互いに独立したストアを使う(片方の更新が他方を消さない)", async () => {
  await ensureStore("sh-e");
  await putShifts(2026, 5, "sh-e", { "2026-05-01": ["s1"] });
  await putRequests(2026, 5, "sh-e", { s1: { want: [], ng: ["2026-05-02"] } });
  // 予定だけを上書きする
  await putShifts(2026, 5, "sh-e", { "2026-05-01": ["s1", "s2"] });

  const data = await getShifts(2026, 5);
  assert.deepStrictEqual(data["sh-e"], { "2026-05-01": ["s1", "s2"] });
  assert.deepStrictEqual(data["_req_sh-e"], { s1: { want: [], ng: ["2026-05-02"] } });
});

// ─────────────────────────────────────────────────────────────────────
// getShiftGaps: 予定にいたが実績に出てこない人を検出する
// ─────────────────────────────────────────────────────────────────────
test("getShiftGaps: 予定にいて日報に出てこないスタッフがgapとして出る", async () => {
  await ensureStore("sh-f");
  await putShifts(PAST_YEAR, 6, "sh-f", { [`${PAST_YEAR}-06-10`]: ["s1", "s2"] });
  await putDay(PAST_YEAR, `${PAST_YEAR}-06-10`, "sh-f", {
    sales_excl_tax: 1000,
    staff_entries: [{ staff_id: "s1", hours: 5 }],
  });

  const gaps = await getShiftGaps(`${PAST_YEAR}-06`);
  assert.deepStrictEqual(gaps, [{ date: `${PAST_YEAR}-06-10`, store_id: "sh-f", staff_id: "s2" }]);
});

test("getShiftGaps: 日報自体が無い日は対象外", async () => {
  await ensureStore("sh-g");
  await putShifts(PAST_YEAR, 7, "sh-g", { [`${PAST_YEAR}-07-10`]: ["s1"] });
  // putDayを一度も呼ばない = 日報が無い
  const gaps = await getShiftGaps(`${PAST_YEAR}-07`);
  assert.deepStrictEqual(gaps.filter((g) => g.store_id === "sh-g"), []);
});

test("getShiftGaps: 予定がnull(閉業日)や空配列はスキップされる", async () => {
  await ensureStore("sh-h");
  await putShifts(PAST_YEAR, 8, "sh-h", {
    [`${PAST_YEAR}-08-10`]: null,
    [`${PAST_YEAR}-08-11`]: [],
  });
  await putDay(PAST_YEAR, `${PAST_YEAR}-08-10`, "sh-h", { staff_entries: [{ staff_id: "s1", hours: 1 }] });
  await putDay(PAST_YEAR, `${PAST_YEAR}-08-11`, "sh-h", { staff_entries: [{ staff_id: "s1", hours: 1 }] });

  const gaps = await getShiftGaps(`${PAST_YEAR}-08`);
  assert.deepStrictEqual(gaps.filter((g) => g.store_id === "sh-h"), []);
});

test("getShiftGaps: 未来日はスキップされる", async () => {
  await ensureStore("sh-i");
  const future = new Date();
  future.setFullYear(future.getFullYear() + 5);
  const ym = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`;
  const dateStr = `${ym}-15`;
  await putShifts(future.getFullYear(), future.getMonth() + 1, "sh-i", { [dateStr]: ["s1", "s2"] });
  await putDay(future.getFullYear(), dateStr, "sh-i", { staff_entries: [{ staff_id: "s1", hours: 1 }] });

  const gaps = await getShiftGaps(ym);
  assert.deepStrictEqual(gaps.filter((g) => g.store_id === "sh-i"), []);
});

test("getShiftGaps: 不正なym形式は400", async () => {
  await assert.rejects(async () => getShiftGaps("not-a-ym"), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("getShiftGaps: 複数gapはdate/store_id/staff_idでソートされる", async () => {
  await ensureStore("sh-j1");
  await ensureStore("sh-j2");
  await putShifts(PAST_YEAR, 9, "sh-j2", { [`${PAST_YEAR}-09-10`]: ["zz"] });
  await putDay(PAST_YEAR, `${PAST_YEAR}-09-10`, "sh-j2", { staff_entries: [{ staff_id: "other", hours: 1 }] });
  await putShifts(PAST_YEAR, 9, "sh-j1", { [`${PAST_YEAR}-09-09`]: ["aa"] });
  await putDay(PAST_YEAR, `${PAST_YEAR}-09-09`, "sh-j1", { staff_entries: [{ staff_id: "other", hours: 1 }] });

  const gaps = await getShiftGaps(`${PAST_YEAR}-09`);
  const relevant = gaps.filter((g) => g.store_id === "sh-j1" || g.store_id === "sh-j2");
  assert.deepStrictEqual(relevant, [
    { date: `${PAST_YEAR}-09-09`, store_id: "sh-j1", staff_id: "aa" },
    { date: `${PAST_YEAR}-09-10`, store_id: "sh-j2", staff_id: "zz" },
  ]);
});

// ─────────────────────────────────────────────────────────────────────
// dismissShiftGap: 単発の不足表示解消
// ─────────────────────────────────────────────────────────────────────
test("dismissShiftGap: 解消後はgetShiftGapsに出てこなくなる", async () => {
  await ensureStore("sh-k");
  const date = `${PAST_YEAR}-10-10`;
  await putShifts(PAST_YEAR, 10, "sh-k", { [date]: ["s1", "s2"] });
  await putDay(PAST_YEAR, date, "sh-k", { staff_entries: [{ staff_id: "s1", hours: 1 }] });

  let gaps = await getShiftGaps(`${PAST_YEAR}-10`);
  assert.ok(gaps.some((g) => g.staff_id === "s2" && g.store_id === "sh-k"));

  const result = await dismissShiftGap({ date, store_id: "sh-k", staff_id: "s2" });
  assert.deepStrictEqual(result, { ok: true });

  gaps = await getShiftGaps(`${PAST_YEAR}-10`);
  assert.ok(!gaps.some((g) => g.staff_id === "s2" && g.store_id === "sh-k"));
});

test("dismissShiftGap: 必須項目が欠けていると400", async () => {
  await assert.rejects(async () => dismissShiftGap({ date: "2026-01-01", store_id: "x" }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
  await assert.rejects(async () => dismissShiftGap(null), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("dismissShiftGap: 存在しないstore_idは400", async () => {
  await assert.rejects(
    async () => dismissShiftGap({ date: "2026-01-01", store_id: "sh-nonexistent", staff_id: "s1" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      return true;
    }
  );
});

test("dismissShiftGap: 不正な形式のdateは400(素のエラーが伝播して500になる旧バグの回帰テスト)", async () => {
  await ensureStore("sh-l");
  await assert.rejects(
    async () => dismissShiftGap({ date: "not-a-date", store_id: "sh-l", staff_id: "s1" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      return true;
    }
  );
});

test("dismissShiftGap: ロック済み月は423", async () => {
  await ensureStore("sh-m");
  try {
    await lockMonth(2026, 11);
    await assert.rejects(
      async () => dismissShiftGap({ date: "2026-11-01", store_id: "sh-m", staff_id: "s1" }),
      (err) => {
        assert.strictEqual(err.status, 423);
        assert.match(err.message, /給与確定済み/);
        return true;
      }
    );
  } finally {
    await cleanupLock(2026, 11);
  }
});

// ─────────────────────────────────────────────────────────────────────
// reconcileShiftGapsForReport: 本番事故の再発防止が最重要
// ─────────────────────────────────────────────────────────────────────
test("reconcileShiftGapsForReport: 欠席者のgapだけが解消される", async () => {
  await ensureStore("sh-n");
  const date = `${PAST_YEAR}-12-10`;
  await putShifts(PAST_YEAR, 12, "sh-n", { [date]: ["s1", "s2", "s3"] });
  await putDay(PAST_YEAR, date, "sh-n", {
    staff_entries: [{ staff_id: "s1", hours: 1 }, { staff_id: "s3", hours: 1 }],
  });

  let gaps = await getShiftGaps(`${PAST_YEAR}-12`);
  const relevantBefore = gaps.filter((g) => g.store_id === "sh-n");
  assert.deepStrictEqual(relevantBefore, [{ date, store_id: "sh-n", staff_id: "s2" }]);

  await reconcileShiftGapsForReport(date, "sh-n", ["s1", "s3"]);

  gaps = await getShiftGaps(`${PAST_YEAR}-12`);
  assert.deepStrictEqual(gaps.filter((g) => g.store_id === "sh-n"), []);
});

test("【回帰・最重要】reconcileShiftGapsForReportはshiftsストア自体を一切書き換えない", async () => {
  await ensureStore("sh-o");
  const date = `${PAST_YEAR}-12-11`;
  await putShifts(PAST_YEAR, 12, "sh-o", { [date]: ["s1", "s2"] });
  const before = await getShifts(PAST_YEAR, 12);

  // s1だけが出勤したことにして(s2が欠席)、過去の事故の再現(前回の実績での
  // 丸ごと上書き)が起きていないかを検証する。
  await reconcileShiftGapsForReport(date, "sh-o", ["s1"]);

  const after = await getShifts(PAST_YEAR, 12);
  assert.deepStrictEqual(
    after["sh-o"],
    before["sh-o"],
    "reconcileShiftGapsForReportがshiftsストアの予定データを変更してしまっている(本番事故の再発)"
  );
  assert.deepStrictEqual(after["sh-o"][date], ["s1", "s2"], "予定(s2含む)が実績で上書きされてはならない");
});

test("reconcileShiftGapsForReport: 全員出勤していれば何も変更しない", async () => {
  await ensureStore("sh-p");
  const date = `${PAST_YEAR}-12-12`;
  await putShifts(PAST_YEAR, 12, "sh-p", { [date]: ["s1", "s2"] });
  await putDay(PAST_YEAR, date, "sh-p", {
    staff_entries: [{ staff_id: "s1", hours: 1 }, { staff_id: "s2", hours: 1 }],
  });

  await reconcileShiftGapsForReport(date, "sh-p", ["s1", "s2"]);

  const gaps = await getShiftGaps(`${PAST_YEAR}-12`);
  assert.deepStrictEqual(gaps.filter((g) => g.store_id === "sh-p"), []);
});

test("reconcileShiftGapsForReport: 不正な形式のdateでも例外を投げず静かに終了する(python版と同じ)", async () => {
  await assert.doesNotReject(async () => reconcileShiftGapsForReport("not-a-date", "sh-nonexistent", ["s1"]));
});

test("reconcileShiftGapsForReport: 予定が無い日・store_idでも例外を投げない", async () => {
  await ensureStore("sh-q");
  await assert.doesNotReject(async () => reconcileShiftGapsForReport(`${PAST_YEAR}-12-31`, "sh-q", ["s1"]));
});

// ─────────────────────────────────────────────────────────────────────
// ルーター層経由(localApiCall)
// ─────────────────────────────────────────────────────────────────────
test("localApiCall経由: PUT/GET /shifts/:year/:month/:store_id", async () => {
  await ensureStore("sh-r");
  await localApiCall("PUT", "/shifts/2027/1/sh-r", { "2027-01-01": ["s1"] });
  const data = await localApiCall("GET", "/shifts/2027/1");
  assert.deepStrictEqual(data["sh-r"], { "2027-01-01": ["s1"] });
});

test("localApiCall経由: PUT /shifts/:year/:month/:store_id/requests", async () => {
  await ensureStore("sh-s");
  await localApiCall("PUT", "/shifts/2027/2/sh-s/requests", { s1: { want: [], ng: [] } });
  const data = await localApiCall("GET", "/shifts/2027/2");
  assert.deepStrictEqual(data["_req_sh-s"], { s1: { want: [], ng: [] } });
});

test("localApiCall経由: GET /shifts/gaps?ym=... が /shifts/:year/:month に横取りされない", async () => {
  await ensureStore("sh-t");
  const date = `${PAST_YEAR}-06-20`;
  await localApiCall("PUT", `/shifts/${PAST_YEAR}/6/sh-t`, { [date]: ["s1", "s2"] });
  await putDay(PAST_YEAR, date, "sh-t", { staff_entries: [{ staff_id: "s1", hours: 1 }] });

  const gaps = await localApiCall("GET", `/shifts/gaps?ym=${PAST_YEAR}-06`);
  assert.ok(Array.isArray(gaps));
  assert.ok(gaps.some((g) => g.store_id === "sh-t" && g.staff_id === "s2"));
});

test("localApiCall経由: POST /shifts/gaps/dismiss", async () => {
  await ensureStore("sh-u");
  const date = `${PAST_YEAR}-06-21`;
  await localApiCall("PUT", `/shifts/${PAST_YEAR}/6/sh-u`, { [date]: ["s1"] });
  const result = await localApiCall("POST", "/shifts/gaps/dismiss", {
    date,
    store_id: "sh-u",
    staff_id: "s1",
  });
  assert.deepStrictEqual(result, { ok: true });
});
