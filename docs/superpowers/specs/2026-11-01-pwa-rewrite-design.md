# jisseki-app PWA化 設計書

## 背景・目的

現行の product/standalone-v1 ブランチは、FastAPI(Python)サーバー + ブラウザからの
アクセスという構成で、買い手のPC(または当初検討したAndroid/Termux)を常時起動
しておく必要があった。買い手が実際にはiPad/iPhone(iOS)であることが判明し、
iOSでは現行のPythonスタック(pydantic-core等のC拡張)を実機で安定動作させる
現実的な方法が無いことが判明した(Pyto/a-ShellはiOSの制約でC拡張を実行時に
読み込めない、iSHはPython実行時に"Bad System Call"でクラッシュする報告がある)。

このため、サーバーを完全に撤去し、**ブラウザの中だけで完結するPWA
(Progressive Web App)** として作り直す。データは各端末のIndexedDBに保存し、
静的ファイル(HTML/CSS/JS)はGitHub Pagesで無料・永続ホスティングする。

## 非ゴール

- 振り返り(reflections)機能は削除する(ユーザー指示)。
- 写真アップロードによる日報OCR機能は搭載しない(ユーザー判断: ブラウザから
  直接Anthropic APIを呼ぶ実装はAPIキー管理・コストの複雑さを増やす割に、
  買い手はiPad上で直接入力できるため必須ではない)。これに伴い、
  frontend/nippo-log.js・frontend/nippo-img.html・routers/upload.pyは
  移植しない。なおnippo-log.jsは現行のproduct/standalone-v1時点で既に
  Google Driveサムネイル表示(GAS/LINE連携時代の名残)に依存しており、
  画像URLが入力される経路が既に無い(前回のfix-waveで「常に画像なし表示」と
  指摘済みの既知の状態)ため、削除しても実質的な機能喪失は無い。
  手書き日報の代替として、frontend/daily.js(日次入力画面)に自由記述の
  「メモ」欄を新設する。iPad上で直接入力する運用とする。
- 複数端末間のリアルタイム同期は行わない(本人1台での運用が前提。将来
  複数端末で同じデータを見たい場合は別途の仕組みが必要になるが、今回は
  スコープ外)。
- GAS/LINE連携は引き続きスコープ外(product/standalone-v1で既に削除済み)。

## アーキテクチャ概要

```
買い手のiPad/iPhone (ホーム画面に追加したPWA)
├── Service Worker: 静的アセットをキャッシュ、オフラインでも画面が開ける
├── フロントエンド(frontend/*.js): 既存コードをほぼそのまま再利用
│    └── App.api(method, path, body) の呼び出し先を差し替える
│         旧: fetch(API + path, ...) → FastAPIサーバーへHTTPリクエスト
│         新: ローカルルーター(新規作成)が path をパターンマッチし、
│             対応するJS関数(旧routers/*.pyの移植版)をその場で呼ぶ
├── ローカルルーター + ビジネスロジック層(新規): 旧routers/*.py 1対1移植
│    各関数はIndexedDBを直接読み書きする(旧data_io.pyのJSON読み書きの代替)
├── IndexedDB: stores / staff / daily_<年> / shifts / inventory /
│    settings / license / payroll_locks / payroll_snapshots / targets 等
│    (旧data/*.jsonの各ファイルを1オブジェクトストアに対応させる)
└── 外部ネットワーク通信は一切行わない(完全オフライン動作)
```

静的ファイルはGitHub Pages(リポジトリ: ghonfex-alt/jisseki-app-pwa、仮)で
ホスティングする。買い手は初回そのURLをSafariで開き、「ホーム画面に追加」
するだけでインストール完了。iOSの「7日間アクセスが無いとローカルストレージを
消去する」ポリシーは、ホーム画面に追加したアプリ(Safari単体のタブとは別の
ストレージ領域を持つ)には適用されないことを確認済み。

## データ層: IndexedDB設計

`db.js`(新規)が単一のラッパーを提供する。DB名 `jisseki-db`、バージョン管理は
将来のスキーマ変更に備えて `upgradeneeded` で各オブジェクトストアを作成する。

オブジェクトストア一覧(旧data/*.jsonとの対応):
| オブジェクトストア | 旧ファイル | キー |
|---|---|---|
| stores | stores.json | store_id |
| staff | staff.json | staff_id |
| daily | daily_<年>.json | `${year}-${date}` (年をまたぐクエリを単純化するため年もキーに含める) |
| shifts | shifts.json | `${year}-${month}-${store_id}` |
| shift_requests | shift_requests.json相当 | 同上 |
| shift_gap_dismissed | shift_gap_dismissed.json | 複合キー文字列 |
| inventory | inventory.json | store_id |
| inventory_log | inventory_log.json | 自動採番 |
| settings | settings.json | 固定キー'global' |
| license | license.json | 固定キー'global' |
| payroll_locks | payroll_locks.json | `${year}-${month}` |
| payroll_snapshots | payroll_snapshots.json | `${year}-${month}-${store_id}` |
| payroll_adjustments | payroll_adjustmentsに相当 | 複合キー |
| targets | targets.json | store_id |
| nippo_confirmed | nippo_confirmed.json | 複合キー |
| images | 旧data/images/のメタ情報 | 自動採番(実ファイルはIndexedDBにBlobとして保存) |

`db.js` は `dbGet(store, key)` / `dbPut(store, key, value)` /
`dbGetAll(store)` / `dbDelete(store, key)` の薄いPromiseラッパーのみ提供し、
業務ロジックは持たない(旧data_io.pyの役割分担と同じ: data_io.pyもファイル
I/Oだけで業務ロジックは持っていなかった)。

## ローカルルーター

`local-api.js`(新規)が `App._rawApi` を置き換える。既存の
`App.api(method, path, body)` のインターフェースは変えない(呼び出し側の
frontend/*.jsは無改修で済む)。内部でpathを正規表現マッチングし、対応する
ハンドラ関数を呼ぶ。旧routers/*.pyの `@router.get("/{store_id}")` のような
FastAPIのパスパラメータ構文を、同等の正規表現(例:
`/^\/inventory\/([^/]+)$/`)に1対1で機械的に変換する。

エラー処理: 旧 `HTTPException(404, ...)` は `throw new ApiError(404, "...")`
(新規定義)に対応させ、`local-api.js`がこれを捕捉して
`App._rawApi`が投げていたのと同じ形(`err.status`付きの`Error`)に変換する
ことで、呼び出し側(`App.api`の`.catch`で`e.status`を見ているコード)の
挙動を変えない。

## 移植対象(routers/*.py → 対応するJSモジュール)

| 旧ファイル | 新ファイル | 備考 |
|---|---|---|
| routers/store.py | local/store.js | 店舗CRUD。そのまま移植 |
| routers/staff.py | local/staff.js | スタッフCRUD・ソフト削除 |
| routers/daily.py | local/daily.js | 日次実績CRUD・月次集計。_month_of等のロジックも移植 |
| routers/payroll.py + services/payroll.py | local/payroll.js | 給与計算ロジック本体。最も複雑(研修時給・ワンオペ手当・控除計算等) |
| routers/payroll_admin.py | local/payroll-admin.js | 確定・調整 |
| routers/export.py + services/excel_writer.py | local/export.js | Excel出力はSheetJS(新規CDN依存、後述)で代替 |
| routers/upload.py | (移植しない) | OCR機能を削除したため不要。daily.jsのメモ欄で代替 |
| routers/shifts.py | local/shifts.js | シフト関連。shift.html/shift-app.js用 |
| routers/targets.py | local/targets.js | 月次目標 |
| routers/inventory.py | local/inventory.js | 在庫CRUD。あわせてユーザー要望(お酒の種類を登録してシンプルな+-管理)の
   汎用化もここで行う |
| routers/settings.py | local/settings.js | wanope_bonus等 |
| routers/license.py | local/license.js | SHA-256ハッシュ比較はWeb Crypto API(`crypto.subtle.digest`)で実装 |
| routers/sync.py | 削除(GAS連携済み・残存ロジックのみ必要なら移植) | get_store_history等、ローカル完結する部分だけ必要に応じ移植 |
| data_io.py | db.js | 上記の通り |

`services/pdf_writer.py`(存在すれば)・`services/shift_editor_html.py`は
frontend側で完結するHTML生成なので、対応するJSに置き換える(大半は
generate_report.py型のテンプレート文字列生成であり、ブラウザ内でも
同じ文字列結合で実現できる)。

## Excel出力の代替

services/excel_writer.py(openpyxlでxlsx生成)は、ブラウザから直接xlsxを
生成できる **SheetJS (xlsx)** ライブラリ(cdnjs提供、UMDビルド)で代替する。
生成したファイルはBlobとして作り、`<a download>`リンクではなくPWAの制約を
踏まえ、Web Share API(`navigator.share`。対応していない場合は
`URL.createObjectURL`経由でブラウザの標準ダウンロード動作にフォールバック)
で保存させる。

## ライセンスゲート

現行と同じ「入力されたキーのSHA-256ハッシュを固定リストと比較」方式を
そのままJSに移植する。`_VALID_KEY_HASHES`相当の定数はJSファイル内に
埋め込む(現行のPython版と同じ強度。買い手ごとに新しいキー/ハッシュに
差し替えるのも同じ運用)。

## 日報の電子化(OCRの代替)

写真OCRは搭載しない(非ゴール参照)。代わりに、frontend/daily.jsの日次入力
画面に自由記述の「メモ」欄(textarea)を1つ新設する。スタッフ・店舗責任者が
その場でiPad/iPhoneから直接入力する運用とし、写真・OCR・外部API呼び出しは
一切発生しない。保存先はIndexedDBの`daily`ストアの該当日エントリに
`memo`フィールドとして追加する(旧`daily_<年>.json`のレコード構造に
1フィールド追加するだけなので、他のフィールドへの影響は無い)。

## データのエクスポート/インポート(新設)

機種変更・紛失時の保険として、設定画面に「データを書き出す」
「データを読み込む」を新設する。IndexedDBの全ストアをJSON1ファイルに
まとめて書き出し(Web Share APIまたはダウンロード)、別端末で同じPWAを
開いて読み込めば復元できるようにする。

## PWAインフラ

- `manifest.json`: 既存のmanifest.json/shift-manifest.jsonを統合・更新
  (アイコン、`display: standalone`、`start_url`)。
- `sw.js`: 既存のサービスワーカーをベースに、アプリシェル(HTML/CSS/JS)を
  cache-firstでキャッシュする。外部ネットワーク通信が無いため、
  これだけで完全オフライン動作になる。
- バージョニング: デプロイのたびにキャッシュ名をインクリメントし、
  古いキャッシュを`activate`イベントで破棄する(既存のshift-sw.jsの
  バージョニング方式を踏襲)。

## ホスティング・デプロイ

GitHub Pages(アカウント: ghonfex-alt)。`gh repo create`で新規リポジトリを
作成し、ビルド済み静的ファイル一式をpushして `gh` またはリポジトリ設定で
Pagesを有効化する(mainブランチの/ディレクトリから配信、または
`gh-pages`ブランチ)。ビルドステップ(バンドラ等)は導入せず、現行と同じ
「素のHTML/JS/CSSファイルをそのまま配信」方式を維持する(複雑さを増やさない)。

## 移行しないデータ

現行の買い手はまだ実運用を開始していない(Task 9でdata/を出荷時の空状態に
したばかり)ため、PWA版への既存データ移行は考慮不要。ゼロから開始する。

## テスト方針

現行のPythonテスト(pytest, tests/以下)はそのまま使えない(ロジックが
JSに移る)。移植した各JSモジュールに対応するJSユニットテストを、
Node.js上で `fake-indexeddb`(IndexedDBのNode実装、CDN不要・devDependency
としてのみ使用、本番には同梱しない)を使って書く。ブラウザ実機での
最終確認はこちらで用意したheadless Chromeベースの手動検証に加え、
買い手のiPhone/iPad実機での最終確認を必須とする(こちらにiOS実機が無いため)。
