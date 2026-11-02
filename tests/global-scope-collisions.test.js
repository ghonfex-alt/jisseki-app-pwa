"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// audit-loop(2026-11-01)で発見した実害バグ(Critical)の再発防止テスト:
// frontend/app.jsとlocal/payroll.jsの両方が同名のグローバル関数
// `getEffectiveRate` を定義しており(非モジュールの<script>タグが1ページに
// 複数読み込まれるこのPWAの構造上、両方ともwindowの同じプロパティに
// 書き込まれる)、後から読み込まれる側が先の定義を上書きしていた。
// local/export.js(Excel出力)はpayroll.js側の実装に依存してbareな
// `getEffectiveRate`を呼んでいたため、実際には意図しない方の実装が使われ、
// 研修時給を卒業したスタッフの時給計算が常に間違っていた。
// Node側のテストスイートはfrontend/*.jsを読み込まないため、この種の衝突は
// 個別のユニットテストでは検出できない——このテストはソースファイルを
// 静的に走査し、同じ名前が「local/*.js が root.X=X でwindowに公開している
// 関数名」と「frontend/*.js がトップレベルのfunction宣言で定義している
// 関数名(=非モジュールscriptなので暗黙的にwindowのプロパティになる)」の
// 両方に出てきたら衝突として検出する。
//
// frontend/index.htmlが実際に読み込む<script>の集合(このテストが対象とする
// 「同じページを共有するファイル」の定義)と一致させること。

const REPO_ROOT = path.join(__dirname, "..");

const LOCAL_FILES = [
  "local/store.js",
  "local/staff.js",
  "local/daily.js",
  "local/tax-table-r8.js",
  "local/payroll.js",
  "local/payroll-admin.js",
  "local/export.js",
  "local/backup.js",
  "local/shifts.js",
  "local/inventory.js",
  "local/targets.js",
  "local/settings.js",
];

const FRONTEND_FILES = [
  "frontend/app.js",
  "frontend/setup.js",
  "frontend/summary.js",
  "frontend/settings.js",
  "frontend/daily.js",
  "frontend/payroll.js",
  "frontend/annual.js",
  "frontend/shift-app.js",
  "frontend/inventory.js",
];

function extractRootExports(relPath) {
  const src = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  const names = new Set();
  // root.foo = foo; / root.foo = function... の形(local/*.js共通のexport方式)。
  const re = /\broot\.([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while ((m = re.exec(src))) {
    names.add(m[1]);
  }
  return names;
}

function extractTopLevelFunctionNames(relPath) {
  const src = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  const names = new Set();
  // 行頭(インデント無し)の `function name(...)` のみを対象にする
  // (IIFE/コールバック内にネストされた同名のローカル関数を誤検知しないため)。
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    names.add(m[1]);
  }
  return names;
}

test("local/*.jsがwindowに公開する関数名とfrontend/*.jsのトップレベル関数名が衝突しない", () => {
  const exportedByFile = new Map();
  LOCAL_FILES.forEach((f) => exportedByFile.set(f, extractRootExports(f)));

  const topLevelByFile = new Map();
  FRONTEND_FILES.forEach((f) => topLevelByFile.set(f, extractTopLevelFunctionNames(f)));

  const collisions = [];
  for (const [localFile, exportedNames] of exportedByFile) {
    for (const [frontFile, topNames] of topLevelByFile) {
      for (const name of exportedNames) {
        if (topNames.has(name)) {
          collisions.push(`"${name}" は ${localFile}(root.${name}=...) と ${frontFile}(トップレベルのfunction宣言)の両方で定義されています`);
        }
      }
    }
  }

  assert.deepStrictEqual(
    collisions,
    [],
    "グローバル関数名の衝突が見つかりました(後から読み込まれる側が先の定義を上書きします):\n" + collisions.join("\n")
  );
});

test("frontend/*.js同士でもトップレベル関数名が衝突しない(同じ理由で後勝ちになるため)", () => {
  const topLevelByFile = new Map();
  FRONTEND_FILES.forEach((f) => topLevelByFile.set(f, extractTopLevelFunctionNames(f)));

  const seen = new Map(); // name -> file
  const collisions = [];
  for (const [file, names] of topLevelByFile) {
    for (const name of names) {
      if (seen.has(name) && seen.get(name) !== file) {
        collisions.push(`"${name}" は ${seen.get(name)} と ${file} の両方でトップレベル関数として定義されています`);
      } else {
        seen.set(name, file);
      }
    }
  }

  assert.deepStrictEqual(
    collisions,
    [],
    "フロント側ファイル間でのグローバル関数名の衝突が見つかりました:\n" + collisions.join("\n")
  );
});
