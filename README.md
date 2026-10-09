# US Amex Application Support / Offer Lab

US American Express申込を人間が管理しながら支援するための調査プロジェクトです。
現在の実装は **設計見直し中のdraft（v0.6.0）**。米国Business Platinumの全項目入力はv0.5.0で本人から成功報告を受けましたが、v0.6.0の自動読込は実機でパスワード入力後に結果が分からない問題が未解決です。合成データのテスト成功を実機の動作完了とは扱いません。[未解決事項と見直し方針](docs/AUTOFILL-REDESIGN.md)を確認してください。

- **Application Autofill**: 保管庫から読み込んだ本人情報を使い、Chrome拡張の `Amexへ入力` で現在DOMにある項目だけを意味的に検出して入力する。位置・順番や単一selectorに依存しない。
- **Offer Lab**: public/referral/targeted、ログインや通常/プライベート環境などの条件と表示オファーを比較する研究基盤。安全なObservationスキーマと観測ハーネスを実装済み。高額オファー判定機能は未実装。
- **application-probe（今回）**: 人間によるfocus/input/change/blurとHTTP通信の開始を時系列で記録し、安全なDOMメタデータとレポートを作る。

Submit Application、Accept Card、CAPTCHA操作、申込確定、検出回避、proxy rotationは自動化しません。実サイトへダミーデータを送りません。

## セットアップ

Node.js 24 / npm。React、Python、Dockerは不要です。

```sh
npm ci
npm run check
npm run probe -- --help
```

macOSではBraveを既定で起動します。他のOSのBraveは `PROBE_EXECUTABLE` に実行ファイルのパスを指定します。Chromeは `PROBE_BROWSER=chrome`、Playwright Chromiumは `PROBE_BROWSER=chromium`（事前に `npx playwright install chromium`）。ブラウザに変更を加えるstealth設定やUA偽装はありません。

## Autofillを使う

`npm run build:extension` 後、Chromeの拡張管理画面で `dist/extension` を読み込むか再読み込みします。
初回だけ全項目を登録し、Chromeにこの拡張専用の補助プログラムを登録します。以後は公式カード一覧のBusiness Platinum Applyから申込ページを開き、拡張をクリック → 保管庫のパスワード入力 → 「フォームを検出」→「Amexへ入力」。ファイル選択は不要で、読込後は保管庫を自動で閉じます。既存値は保持し、申込送信は行いません。
本人情報はブラウザsession内だけで再利用。ローカルテストは `npm run fixture:autofill` を使い、実データを読み込みません。詳細は[拡張の手順・保存仕様](apps/extension/README.md)。

## 実フォーム調査の開始

1. [SAFETY](docs/SAFETY.md)と[調査手順](docs/RESEARCH.md)を読む。
2. 個人情報やtokenを含まない、使用対象の公開HTTPS URLを `PROBE_URL` 環境変数に設定する。許可する初期hostは `www.americanexpress.com` のみ。秘密のURLをシェル履歴へ貼らない。
3. `npm run probe` を実行する。新規の隔離browser contextが開く。普段のprofileやCookieは読み込まない。実probeはService Workerをallowし、Observationには `serviceWorkers: allowed` と記録する。offline browser smokeはblockを維持する。
4. ターミナルで `inspect` を実行し、存在するフォーム項目の安全なメタデータを確認する。ブラウザで人間がfocus等を操作する。**ダミー入力はしない**。
5. `idle` で無操作の比較区間を開始する。次の操作までは一つの区間となる。
6. `finish` またはCtrl+Cでブラウザを閉じ、`runs/probe-<UUID>/observation.json` と `steps.md` を保存する。通常EOFでも保存する。強制終了・クラッシュ時の回復は未対応。

probe自体はブラウザ操作を代行しません。人間、または明示的に許可されたComputer Use操作を観測します。2026-10-08の追加依頼によりComputer Useで公開商品ページのApply、空欄focus・Tabによるblurを検証しました。Submit/Acceptや値入力は行いません。CLIへ自由文やPIIを入力しないでください。

### 保存される情報と制約

URL query/fragment/credentialsは保存しません。未知hostは `host-1`、未知pathは `/route-1` のような実行内aliasへ変換します。alias対応表はメモリのみ。実URLをGit管理する必要はありません。

probeはDOMの値、全文、未知の属性文字列を保存しません。拡張のプロフィール保存は別経路で、前述の拡張手順に従います。既知の項目名と完全一致する属性のみ残し、他は存在フラグにします。selectorそのものの検証は実機上で行います。`unknown` / `ambiguous` はそのまま記録し、入力対象に昇格させません。

`diagnose` は最小式→関数→document状態→control数→observer存在→observer返却件数を別々に評価し、固定状態・boolean・件数のみを表示します。frameごとの評価が3秒を超えたら残りを止めます（開始済みevaluateのキャンセルはできません）。診断結果はreportへ保存しません。実Amexでの根本原因は未確定です。

`inspect` は累積の `fields` と、今回の取得診断 `inspection` を表示します。診断はpage/frame数、observerの状態（ready / observer-missing / observer-failed / evaluation-failed / projection-failed）、固定の失敗分類、native control数、今回取得したfield数、現URLを既存application code parserで解析できたかの真偽値だけです。raw URL・code値・例外本文は出力せず、診断は既存reportへ自動保存しません。native control数にはhidden/button等も含み、field数とは定義が異なります。過去のfieldsが残っていても、現在のページを取得できた証拠にはなりません。

通信は開始時刻で操作と対応付けます。レスポンスが後から返っても別の操作へ付け替えません。ただし関連は **temporal-only** であり、因果関係は証明しません。通信がない区間も「その観測範囲で未観測」の意味です。Service Workerをallowしても、WebSocket frame・browser内部通信・一部SW挙動を含むNetworkの完全取得は保証しません。詳細な計測範囲は[ARCHITECTURE](docs/ARCHITECTURE.md)参照。

application code parserは明示的な `applicationCode` queryを優先し、queryがない場合はpathname末尾（例 `.../business-platinum-charge-card/68443-9-0`）を解析します。書式は観測例に基づく制約で、Amex公式仕様とは断定しません。重複・不正queryはpathへfallbackせず拒否します。

## 検証

```sh
npm run check         # lint / typecheck / unit tests / formatting
npm run test:browser  # macOS Brave: 完全ローカルの模擬ページ
# 他の環境:
npx playwright install chromium
PROBE_TEST_BROWSER=chromium npm run test:browser
PROBE_TEST_BROWSER=chromium npm run test:extension
```

probeのブラウザテストは `fixture.invalid` をPlaywright内で応答し、それ以外をabortします。拡張テストはloopback模擬フォーム・当該拡張のリソース、および公式originをroute.fulfillで完全にローカル応答する試験で、保存・再利用・削除・検出・Fill Nowを実MV3で検証します。CIから実Amexにはアクセスしません。`PRIVATE_SENTINEL` は除外確認用の非PII文字列で、外部へ送信されません。

## 構成・資料

- `tools/application-probe/`: 手動調査CLI、操作・通信レコーダー、安全なレポート
- `packages/core/`: URL parser、allow-list投影、DOM候補識別、厳格なschema
- `apps/extension/`: ロード可能なMV3拡張MVP。全申込項目の保管庫profile、実Amex Autofill、ローカルテスト
- [REQUIREMENTS](docs/REQUIREMENTS.md): スコープ、MVP、非機能要件
- [ARCHITECTURE](docs/ARCHITECTURE.md): 構成とデータフロー
- [RESEARCH](docs/RESEARCH.md): Confirmed / Probable / Hypothesis / Unknownと実機手順
- [SAFETY](docs/SAFETY.md): 保存禁止・調査境界

旧Selenium、Discord、proxy/stealth設定、rawページdump、Python CI、Dockerを撤去しました。MIT LICENSEは保持しています。既存の無視対象 `.env` / `runs` / browser関連データは読み込まず、移行・削除していません。

## 残る検証

追加情報登録後の全項目実入力と申込画面の本人確認、Offer Labの高額オファー判定機能、既存Playwright probeのmain frame DOM取得問題は別々に追跡します。拡張のISOLATED worldでは実Amexの7項目を検出済みで、probeの原因解決を意味しません。
