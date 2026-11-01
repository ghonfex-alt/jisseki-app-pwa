# jisseki-app PWA化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** jisseki-appをサーバー不要・完全ブラウザ内完結のPWAとして作り直し、GitHub Pagesで
ホスティングし、iPad/iPhoneの買い手がホーム画面に追加して使えるようにする。

**Architecture:** 既存のPython(`routers/*.py`・`services/*.py`・`data_io.py`)のロジックを、
同じインターフェース(`App.api(method, path, body)`)を保ったままJavaScript + IndexedDBへ
1対1で移植する。フロントエンドのHTML/JS(`frontend/*.js`)は`App.api`呼び出しを変更せず
ほぼそのまま再利用する。

**Tech Stack:** 素のJavaScript(ビルドツール無し)、IndexedDB、Service Worker、SheetJS(CDN、
Excel出力のみ)。

**Spec:** `docs/superpowers/specs/2026-11-01-pwa-rewrite-design.md`

## 追加要件: キャッチ・呼び・延長インセンティブ(JISSEKI_SRCには存在しない新機能)

買い手の業態(ガールズバー系)の実態に合わせ、既存の「ドリンクバック」(`entry.drinks`、
1本¥70固定)と同じ考え方で、以下3種類のインセンティブをスタッフの日次実績に追加する。
ただし単価・計算方式は買い手側で未確定のため、**設定画面で後から自由に変更できる値**に
すること(ドリンクの¥70のようにコード内に固定値を埋め込まない)。

- **キャッチ**(客引き成功): `entry.catch_count`(当日の回数、整数)
- **呼び**(指名呼び出し): `entry.call_count`(同上)
- **延長**(セッション延長): `entry.extension_count`(同上。「30分単位」等の単位の意味は
  運用上のラベルに過ぎず、アプリ側は常に「回数」として数える。ドリンクと全く同じ扱い)

**設定(`settings`ストア)に追加するフィールド**:
```
incentive_rates: {
  catch:     { yen_per_count: 0 },
  call:      { yen_per_count: 0 },
  extension: { yen_per_count: 0 },
}
```
(初期値は全て0円。買い手が設定画面で実際の単価を入力するまでは給与に影響しない、
安全な既定値。ワンオペ手当の既定値を0にした過去の教訓と同じ考え方。)

**計算式**(services/payroll.pyのドリンク計算 `drinks * 70` と全く同じ形):
`catch_count * incentive_rates.catch.yen_per_count + call_count * incentive_rates.call.yen_per_count
+ extension_count * incentive_rates.extension.yen_per_count` を日給に加算する。

**パーセンテージ方式は今回実装しない**: ユーザーから「パーセンテージかもしれない」という
話があったが、「何に対する割合か」(当日の店舗売上? そのスタッフの担当分?)が未確定のため、
今回は固定単価方式(上記)のみ実装する。パーセンテージ方式を後日追加したくなった場合は、
計算の基準となる値をユーザーに確認してから別タスクとして追加する。

## Global Constraints

- サーバー・Python・外部ネットワーク通信は一切使わない(Excel出力・OCR等も全てブラウザ内で完結)。
  唯一の例外は無し(OCRは非ゴールとして削除済み)。
- 移植元のPythonコードは `C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build`
  (以下 `JISSEKI_SRC`)にある。各タスクは対応するPythonファイルのロジックを**忠実に**移植する
  (仕様を変えない。バグに見える挙動も、意図的な既存の仕様である可能性があるため、
  ロジックを変更する場合はタスクのレポートに理由を明記すること)。
- このリポジトリ(`jisseki-app-pwa`)は新規。`JISSEKI_SRC`は参照のみ、絶対に書き換えない。
- 振り返り(reflections)・日報写真OCR(nippo-log/nippo-img/upload)は移植しない(非ゴール)。
- 全ての`frontend/*.js`中の絶対パス(`/static/...`, `/manifest.json`等)は、GitHub Pagesが
  サブパス(`https://ghonfex-alt.github.io/jisseki-app-pwa/`)で配信されるため、相対パスに
  直すこと(`/static/app.js` → `static/app.js`)。これを忘れると買い手の端末で画面が
  真っ白になる、最も壊れやすいポイントなので全タスクで意識すること。
- 各タスク完了時、該当するJSモジュールのユニットテスト(Node.js + `fake-indexeddb`、
  devDependencyのみ、本番コードには含めない)を書き、通すこと。
- 日本語コミットメッセージ、このリポジトリの既存コミット規約(`feat:`/`fix:`/`docs:`等)に
  合わせる。

---

### Task 1: リポジトリ基盤・db.jsラッパー

**Files:**
- Create: `db.js` (IndexedDBの薄いPromiseラッパー)
- Create: `package.json` (devDependencyとして `fake-indexeddb` のみ)
- Create: `tests/db.test.js`
- Create: `tests/setup.js` (fake-indexeddbをグローバルに注入するテストセットアップ)

**Interfaces:**
- Produces: `dbGet(storeName, key)` → Promise\<value|undefined\>、
  `dbPut(storeName, key, value)` → Promise\<void\>、
  `dbGetAll(storeName)` → Promise\<Array\<value\>\>、
  `dbDelete(storeName, key)` → Promise\<void\>、
  `dbOpen()` → Promise\<void\> (アプリ起動時に一度呼び、オブジェクトストアを作成する)。
  これらはグローバル関数として`window`に公開する(他のtaskのJSファイルから`<script>`タグ
  読み込みだけで使えるようにするため。モジュールバンドラは使わない)。

**オブジェクトストア一覧**(`dbOpen`内の`upgradeneeded`で全て作成する):
`stores`, `staff`, `daily`, `shifts`, `shift_requests`, `shift_gap_dismissed`,
`inventory`, `inventory_log`, `settings`, `license`, `payroll_locks`,
`payroll_snapshots`, `payroll_adjustments`, `targets`, `nippo_confirmed`。
DB名は`jisseki-db`、バージョンは`1`。

- [ ] 上記関数を実装する。
- [ ] `tests/db.test.js`: 各オブジェクトストアに対して put→get→getAll→delete の
  一連の動作を検証するテストを書く(素朴なJestでもNode標準の`node:test`でもよい。
  `package.json`に`"test": "node --test tests/"`のようなスクリプトを用意する)。
- [ ] テストを実行して通ることを確認する。
- [ ] コミット: `feat: IndexedDBラッパー(db.js)を追加`

---

### Task 2: local-api.js(ローカルルーター)の骨格 + ApiError

**Files:**
- Create: `local-api.js`
- Create: `tests/local-api.test.js`

**Interfaces:**
- Consumes: Task 1の`dbGet`/`dbPut`/`dbGetAll`/`dbDelete`。
- Produces: `class ApiError extends Error { constructor(status, message) }`(他タスクが
  `throw new ApiError(404, "store not found")`のように使う)。
  `registerRoute(method, pattern, handler)` — pattern は例えば
  `"/stores/:store_id"` のような簡易記法(`:name`でパスパラメータをキャプチャ)。
  `async function localApiCall(method, path, body)` — 登録済みルートの中から
  methodとpathが一致するものを探し、`handler(params, body)`を呼んでその戻り値を返す。
  一致するルートが無ければ`throw new ApiError(404, "not found: " + method + " " + path)`。

**Step 1: パスパターンマッチングの実装**
`:store_id`のようなコロン記法のパターンを正規表現に変換し、マッチした部分をパラメータ
オブジェクト(`{store_id: "..."}`)として渡す薄いルーターを実装する。クエリ文字列
(`?limit=100`のような箇所)も`params`に含める(`URLSearchParams`で分解)。

- [ ] 実装する。
- [ ] `tests/local-api.test.js`: `registerRoute("GET", "/foo/:id", (p) => p.id)` を登録して
  `localApiCall("GET", "/foo/123")` が `"123"` を返すこと、未登録パスで`ApiError`(404)が
  投げられること、を検証する。
- [ ] コミット: `feat: ローカルAPIルーター(local-api.js)の骨格を追加`

---

### Task 3: local/store.js + local/staff.js(店舗・スタッフCRUD)

**Files:**
- Create: `local/store.js`
- Create: `local/staff.js`
- Create: `tests/local-store.test.js`
- Create: `tests/local-staff.test.js`
- Reference(移植元、読むだけ): `JISSEKI_SRC/routers/store.py`, `JISSEKI_SRC/routers/staff.py`

**Interfaces:**
- Consumes: Task 1のdb関数、Task 2の`registerRoute`/`ApiError`。
- Produces: 両ファイルとも、読み込まれた時点で`registerRoute`を呼んで自分のルートを
  登録する(副作用としての自己登録。`<script src="local/store.js">`を読み込むだけで
  使えるようにする)。

**移植対象(store.py)**: `GET /stores`, `GET /stores/{store_id}`, `PUT /stores/{store_id}`,
`POST /stores`, `DELETE /stores/{store_id}`(スタッフ・日次データが残っている場合は
409相当の`ApiError`), `ChampagneUpdate`関連のシャンパンメニューCRUD。
`check_store_id`相当のバリデーションヘルパーも移植し、他タスクから
`import`(スクリプトタグなので実体は`window.checkStoreId`等のグローバル関数)できるようにする。

**移植対象(staff.py)**: `GET /staff`, `GET /staff/{staff_id}`, `POST /staff`,
`PUT /staff/{staff_id}`, `DELETE /staff/{staff_id}`(ソフト削除、`active=false`に
するだけで削除しない。これは意図的な仕様 — コメント参照)。`_NON_NEGATIVE_FIELDS`の
バリデーション、`store_id`が`None`(両店舗兼務)を許容するロジックも含め忠実に移植する。

- [ ] 両ファイルを実装する(Pythonの各関数と1対1対応させ、関数名もスネークケースを
  キャメルケースに変換した対応が分かる名前にする。例: `create_store` → `createStore`)。
- [ ] テストを書く: 正常系のCRUD一通り、store削除のガード(アクティブなスタッフがいると
  失敗)、staffの`store_id=null`許容、ソフト削除の挙動、を最低限カバーする。
- [ ] テストを通す。
- [ ] コミット: `feat: 店舗・スタッフCRUDをローカルAPIへ移植`

---

### Task 4: local/daily.js(日次実績CRUD + メモ欄)

**Files:**
- Create: `local/daily.js`
- Create: `tests/local-daily.test.js`
- Reference: `JISSEKI_SRC/routers/daily.py`

**Interfaces:**
- Consumes: db関数、`registerRoute`/`ApiError`、Task3の`checkStoreId`。
- Produces: `GET /daily/{year}/{date}/{store_id}`, `PUT /daily/{year}/{date}/{store_id}`,
  `POST /daily/{year}/{date}/{store_id}/reset`, `GET /daily/{year}/month/{month}/{store_id}`,
  `GET /daily/{year}/ym/{ym}` を登録する。

**移植の要点**: `EMPTY_DAY`定数、`_month_of`の日付バリデーション(不正な日付は400相当の
`ApiError`)、リセットは空dictを書くのではなくキー自体を削除する仕様、`_deleted`フラグが
bodyに含まれていても保存結果には残さない仕様、payroll_locksによる確定済み月のPUT拒否
(423相当)——これら全て`JISSEKI_SRC/tests/test_daily_api.py`のテストケース名(例:
`test_reset_deletes_key_entirely_not_empty_dict`,
`test_put_strips_deleted_flag_even_if_body_carries_it`,
`test_put_locked_month_rejected`)がそのまま移植すべき仕様のリストになっている。
このテストファイルを読み、同等のテストケースをJSでも書くこと。

**新設: メモ欄**: 設計書の「日報の電子化」に従い、保存データ構造に`memo`(文字列、
自由記述)フィールドを追加する。バリデーションは無し(何でも保存可)。

**新設: キャッチ・呼び・延長カウント**: 本計画冒頭の「追加要件」の通り、各
`staff_entries`の要素(1スタッフの1日分エントリ)に`catch_count`・`call_count`・
`extension_count`(いずれも整数、デフォルト0)を追加する。バリデーションは既存の
`drinks`フィールドと同じ扱いでよい(負数は拒否する程度)。

- [ ] `JISSEKI_SRC/routers/daily.py`と`JISSEKI_SRC/tests/test_daily_api.py`を読む。
- [ ] `local/daily.js`を実装する。
- [ ] `JISSEKI_SRC/tests/test_daily_api.py`の各テストケースに対応するJSテストを書く
  (大半はそのまま移植できるはず)。
- [ ] `catch_count`/`call_count`/`extension_count`の保存・取得を検証するテストを書く。
- [ ] テストを通す。
- [ ] コミット: `feat: 日次実績CRUDをローカルAPIへ移植し、メモ欄とキャッチ/呼び/延長カウントを追加`

---

### Task 5: local/payroll.js(給与計算ロジック本体)

**Files:**
- Create: `local/payroll.js`
- Create: `tests/local-payroll.test.js`
- Reference: `JISSEKI_SRC/routers/payroll.py`, `JISSEKI_SRC/services/payroll.py`

**このタスクは最重要かつ最複雑。** 研修時給(`rate_history`に基づく実効時給の時系列判定)、
ワンオペ手当(`_get_wanope_bonus()`。現状の既定値は`0`——以前の本番検証で「単体出勤日に
勝手に手当が付く」事故が見つかり0に変更された経緯がある。この既定値は絶対に維持すること)、
シャンパンバック(`champagne_menu`の単価×0.1×本数)、送迎代(`okuri`フラグで片道/往復)、
月給制スタッフの標準報酬・控除計算、を全て忠実に移植する。

**新設: キャッチ・呼び・延長インセンティブ**: 本計画冒頭の「追加要件」の通り、
ドリンクバック(`drinks * 70`)と全く同じ形で、
`catch_count * incentive_rates.catch.yen_per_count`
`+ call_count * incentive_rates.call.yen_per_count`
`+ extension_count * incentive_rates.extension.yen_per_count`
を日給に加算する(`incentive_rates`はTask9で実装する`settings`ストアから読む)。
既定値は全て0円なので、設定が未入力の間は給与に一切影響しない。

- [ ] `JISSEKI_SRC/services/payroll.py`と`JISSEKI_SRC/routers/payroll.py`を完全に読む
  (部分的に読んで移植すると計算式を間違える。給与計算は金銭が関わるため特に慎重に)。
- [ ] `JISSEKI_SRC/frontend/app.js`の`getEffectiveRate`/`calcStaffDayTotal`も確認する
  (フロント側に同じ計算ロジックの複製があり、サーバー側と一致させる設計になっている —
  移植後もこの二重実装の一致を崩さないこと。むしろこのタスクで`local/payroll.js`が
  フロント版と全く同じ計算になるよう統一できるなら、それが望ましい)。
- [ ] `local/payroll.js`を実装する(キャッチ/呼び/延長インセンティブ計算を含む)。
- [ ] テストを書く: 時給制・月給制それぞれの通常計算、研修時給の時系列切り替わり、
  ワンオペ手当が既定で0円であること(既定値0の回帰テストとして明示的に書く)、
  シャンパンバック計算、送迎代の往復/片道、キャッチ/呼び/延長インセンティブが
  既定(単価0円)では給与に影響しないこと、単価を設定した場合に正しく加算されること、
  を最低限カバーする。
- [ ] テストを通す。
- [ ] コミット: `feat: 給与計算ロジックをローカルAPIへ移植`

---

### Task 6: local/payroll-admin.js(確定・調整・ロック)

**Files:**
- Create: `local/payroll-admin.js`
- Create: `tests/local-payroll-admin.test.js`
- Reference: `JISSEKI_SRC/routers/payroll_admin.py`

**Interfaces:**
- Consumes: Task5の給与計算関数(月次確定時に計算結果をスナップショットとして
  `payroll_snapshots`ストアに保存する際に使う)。

移植対象: 月次確定(`payroll_locks`に該当月を書き込み、以後その月のdaily編集を拒否する
—Task4の423相当ガードと対応させる)、確定解除、個別調整(`payroll_adjustments`)。
LINE給与通知(push_line)はGAS連携時代の機能で既にPython側でも削除済みのため移植不要。

- [ ] 実装する。
- [ ] テストを書く(確定→daily編集が423相当で拒否されること、確定解除後は再度
  編集できること、調整の保存・取得)。
- [ ] コミット: `feat: 給与確定・調整機能をローカルAPIへ移植`

---

### Task 7: local/shifts.js(シフト管理)

**Files:**
- Create: `local/shifts.js`
- Create: `tests/local-shifts.test.js`
- Reference: `JISSEKI_SRC/routers/shifts.py`

移植対象: `DismissRequest`(Pydanticモデル。JSでは単なるバリデーション関数にする)、
`is_locked`チェック(確定済み月のシフト編集拒否)、`reconcile_shift_gaps_for_report`
(前月コピー等ではなく、ギャップの記録のみ行う仕様 — これは過去に本番データ破壊事故の
反省から現在の形になった経緯があるため、絶対に「前月コピーで上書き」方式に戻さないこと)。

- [ ] 実装する。
- [ ] テストを書く。
- [ ] コミット: `feat: シフト管理をローカルAPIへ移植`

---

### Task 8: local/inventory.js(在庫管理・汎用化)

**Files:**
- Create: `local/inventory.js`
- Create: `tests/local-inventory.test.js`
- Modify: `frontend/inventory.js`
- Reference: `JISSEKI_SRC/routers/inventory.py`

**移植 + ユーザー要望の反映**: `JISSEKI_SRC/routers/inventory.py`のCRUD
(`get_inventory`/`update_stock`/`add_flavor`/`delete_flavor`/`get_log`)をそのまま
移植する(データモデル自体は「商品名+在庫数+最低在庫数」で既に汎用的)。

あわせて`frontend/inventory.js`の画面側を、以前のユーザー要望(「在庫はお酒の種類なんかを
入力、設定して+-確認出来る感じ」)に合わせて簡略化する: 「フレーバー」という表記を
「商品」に置き換え、「発注」「人気」タブ(シーシャ店時代の機能で今回の買い手の業態には
不要)を削除し、「商品一覧」+「在庫数の+/-ボタン」のシンプルな1画面にする。

- [ ] `local/inventory.js`を実装する。
- [ ] `frontend/inventory.js`を簡略化する(「発注」「人気」タブ・関連関数を削除、
  「フレーバー」表記を「商品」に置換、各商品カードに+/-ボタンを置く)。
- [ ] テストを書く(CRUD、store_id検証、ログ記録)。
- [ ] コミット: `feat: 在庫管理をローカルAPIへ移植し、画面を汎用化`

---

### Task 9: local/targets.js + local/settings.js + local/license.js

**Files:**
- Create: `local/targets.js`, `local/settings.js`, `local/license.js`
- Create: `tests/local-targets.test.js`, `tests/local-settings.test.js`, `tests/local-license.test.js`
- Reference: `JISSEKI_SRC/routers/targets.py`, `JISSEKI_SRC/routers/settings.py`,
  `JISSEKI_SRC/routers/license.py`

**license.jsのみ特記**: SHA-256ハッシュ比較を`crypto.subtle.digest("SHA-256", ...)`
(Web Crypto API、全モダンブラウザ標準搭載)で実装する。`_VALID_KEY_HASHES`相当の定数は
`JISSEKI_SRC/routers/license.py`の値をそのまま持ってくる(デモキーのハッシュ。実販売前に
`docs/seller-notes/`相当の手順で差し替える運用も移植する)。

**settings.jsのみ特記: キャッチ・呼び・延長インセンティブ単価**: 本計画冒頭の
「追加要件」の通り、`GET/PUT /settings`が返す/受け取るオブジェクトに
`incentive_rates: { catch: {yen_per_count}, call: {yen_per_count}, extension: {yen_per_count} }`
を追加する(`wanope_bonus`と同じ階層)。各`yen_per_count`は0以上の数値でバリデーションする
(既存の`wanope_bonus`バリデーション——bool型除外・負数拒否——と同じガードを使う)。
初期値は全て`0`。

- [ ] 3ファイルを実装する(それぞれ小さいので1タスクにまとめた)。
- [ ] テストを書く(settings: wanope_bonusと`incentive_rates`各フィールドのバリデーション
  含む。license: 正しいキー/間違ったキー/文字列以外が送られた場合の3パターン——
  `JISSEKI_SRC/routers/license.py`の「文字列以外で500になる問題を修正」した
  コミット96f8099の修正内容を確認し、同じガードを移植すること)。
- [ ] コミット: `feat: 目標・設定・ライセンス認証をローカルAPIへ移植(キャッチ/呼び/延長単価設定を含む)`

---

### Task 10: local/export.js(Excel出力・SheetJS)

**Files:**
- Create: `local/export.js`
- Create: `tests/local-export.test.js`
- Reference: `JISSEKI_SRC/routers/export.py`, `JISSEKI_SRC/services/excel_writer.py`

`services/excel_writer.py`の月次シートレイアウト(列構成・見出し・書式)を、SheetJS
(`https://cdnjs.cloudflare.com/ajax/libs/xlsx/<pinned version>/xlsx.full.min.js`を
`index.html`で読み込む)で再現する。生成したBlobは、`navigator.share`が使える場合は
それを使い、使えない場合は`URL.createObjectURL`+一時的な`<a>`要素のクリックで
ダウンロードさせる(PWA内でのファイル保存の標準的な代替手段)。

- [ ] `services/excel_writer.py`を読み、列構成を正確に把握する。
- [ ] `local/export.js`を実装する。
- [ ] テストを書く(Node環境でSheetJSのnpm版`xlsx`をdevDependencyとして使い、
  生成したブックの中身(セル値)が期待通りであることを検証する。ブラウザ版CDNとnpm版は
  同じライブラリなのでテストの信頼性は保たれる)。
- [ ] コミット: `feat: Excel出力をSheetJSでローカル実装`

---

### Task 11: local-api.jsへの全ルート登録 + App._rawApi差し替え

**Files:**
- Modify: `local-api.js` (または新規 `local-api-bootstrap.js` に分離してもよい)
- Modify: `frontend/app.js`

Task3〜10で作った各`local/*.js`を全て読み込み、`App._rawApi`の実装を
「fetchでHTTPリクエスト」から「`localApiCall(method, path, body)`を呼ぶ」に
差し替える。`App.api`自体のキャッシュ・重複排除ロジック(`_inFlightGets`/`_getCache`)は
変更不要(`_rawApi`の中身だけ差し替えれば済むように設計されている)。

- [ ] `frontend/app.js`の`_rawApi`を書き換える。
- [ ] `frontend/index.html`に全ての`local/*.js`と`local-api.js`の`<script>`タグを、
  各`frontend/*.js`より前に追加する(自己登録のタイミングのため)。
- [ ] 振り返り(`reflections.js`)・日報ログ(`nippo-log.js`)のnavボタンと`<script>`タグを
  `frontend/index.html`から削除する。
- [ ] 全ての`frontend/*.js`・`frontend/index.html`・`manifest.json`内の絶対パス
  (`/static/...`, `/manifest.json`等)を相対パスに直す(Global Constraints参照)。
- [ ] コミット: `feat: ローカルAPIルーターを全面結線しApp.apiをオフライン化`

---

### Task 12: データのエクスポート/インポート機能(新設)

**Files:**
- Create: `local/backup.js`
- Modify: `frontend/settings.js`

設計書の「データのエクスポート/インポート」節に従い、設定画面に「データを書き出す」
「データを読み込む」ボタンを追加する。書き出しはTask1の全オブジェクトストアを
1つのJSONにまとめ、ダウンロードさせる(Task10と同じダウンロード手段を使い回す)。
読み込みは`<input type="file">`でJSONを受け取り、内容を検証した上で各ストアに書き戻す
(読み込み前に「現在のデータを上書きします。よろしいですか」の確認を挟む——
ただしブラウザのネイティブ`confirm()`は使わず、画面内のモーダルで実装すること。
ネイティブダイアログはこのプロジェクトの既存の方針で避けている)。

- [ ] `local/backup.js`を実装する。
- [ ] `frontend/settings.js`にUIを追加する。
- [ ] テストを書く(書き出し→読み込みで元の内容に戻ることを検証するラウンドトリップ
  テスト)。
- [ ] コミット: `feat: データのエクスポート/インポート機能を追加`

---

### Task 13: フロントエンド最終調整(setup.js・daily.jsメモ欄+インセンティブUI・settings.js単価UI)

**Files:**
- Modify: `frontend/setup.js`
- Modify: `frontend/daily.js`
- Modify: `frontend/settings.js`

setup.js: ライセンス認証・店舗作成の初回セットアップ画面は、`App.api`経由で呼んでいる
ため中身は無改修で動くはずだが、実際に動作確認して問題があれば直す。

daily.js: 仕様書の「日報の電子化」通り、日次入力画面に自由記述の「メモ」
textareaを追加し、保存・表示が正しく動くようにする。あわせて、各スタッフの日次入力欄に
既存の「ドリンク」本数入力と同じ見た目で「キャッチ」「呼び」「延長」の回数入力
(数値、0以上の整数)を追加する(Task4で追加した`catch_count`/`call_count`/
`extension_count`に対応)。

settings.js: 「キャッチ」「呼び」「延長」それぞれの1回あたり単価(円)を入力できる欄を
設定画面に追加する(既存のワンオペ手当設定と同じ見た目・保存パターン)。
ラベルは「キャッチ(1回あたり)」のように、金額の単位が分かる表記にする。

- [ ] daily.jsにメモ欄・キャッチ/呼び/延長カウントのUIを追加する(他の入力欄と同じ
  スタイルで)。
- [ ] settings.jsにキャッチ/呼び/延長の単価設定UIを追加する。
- [ ] 保存・読み込みの動作をテストする(Task4・Task9のAPIと繋がっていることを確認)。
- [ ] setup.jsの動作を確認し、問題があれば直す。
- [ ] コミット: `feat: 日次入力画面にメモ欄・キャッチ/呼び/延長入力・単価設定UIを追加`

---

### Task 14: PWAインフラ(manifest.json・sw.js)

**Files:**
- Modify: `manifest.json`
- Modify: `sw.js`
- Delete: `shift-manifest.json`, `shift-sw.js`(別アプリ扱いだった旧構成。単一アプリに統合)

manifest.jsonを単一アプリ用に整理し(`display: "standalone"`, `start_url: "."`
相対指定、アイコンパス相対化)、sw.jsを全アプリシェルファイル(index.html, 全JS, 全CSS,
manifest.json, アイコン)をcache-firstでキャッシュする構成に書き換える。
デプロイのたびにキャッシュ名をバージョンアップし、`activate`で古いキャッシュを破棄する
処理は既存の`shift-sw.js`の方式を踏襲する。

- [ ] 実装する。
- [ ] ローカルでの動作確認(ブラウザのService Worker登録・Application タブでの
  キャッシュ内容確認)を行う。
- [ ] コミット: `feat: PWAマニフェスト・サービスワーカーを単一アプリ用に整理`

---

### Task 15: GitHub Pagesへのデプロイ

**Files:** (リポジトリ構成の最終調整のみ、新規コード無し)

- [ ] `gh repo create ghonfex-alt/jisseki-app-pwa --public --source=. --remote=origin`
  (または既存の方針に応じてprivateでも可——ただしprivateリポジトリでのGitHub Pagesは
  Freeプランでは使えない制限があるため、要確認の上で判断する)。
- [ ] `git push -u origin main`。
- [ ] `gh api repos/ghonfex-alt/jisseki-app-pwa/pages -X POST -f "source[branch]=main" -f "source[path]=/"`
  相当の操作でGitHub Pagesを有効化する(またはリポジトリ設定画面からの手動操作を案内する)。
- [ ] 公開されたURLに実際にアクセスし、画面が表示されること、コンソールエラーが
  無いことを確認する。
- [ ] 本タスクの担当者は、最終確認として実際に公開URLをブラウザで開いて一通り
  クリックする(セットアップ→店舗作成→日次入力→保存→給与確認、の最低限の導線)。

---

### Task 16: 最終レビューと買い手向け案内の更新

- [ ] 全体のテスト(`npm test`相当、全local/*.test.jsファイル)を実行し、全て通ることを
  確認する。
- [ ] `JISSEKI_SRC`側の`README_SETUP.md`・セットアップガイドPDF・Claude Artifactを、
  このPWA方式(URLを開いてホーム画面に追加するだけ)に合わせて全面的に書き直す
  (Termux関連の記述は全て削除する)。
- [ ] 最終的な公開URLとライセンスキーの運用手順を、
  `JISSEKI_SRC/docs/seller-notes/sale-checklist.md`に追記する。
