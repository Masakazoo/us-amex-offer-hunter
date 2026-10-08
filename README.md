# US Amex Application Support / Offer Lab

US American Express申込を人間が管理しながら支援するための調査プロジェクトです。
現在は **Phase 2A（実Amexの受動調査・一部未確認）**。申込ページのDOM評価失敗が再現し、固定selector候補は手動レビュー済みですが、自動DOM取得には未解決の制約があります。完成したAutofill拡張ではありません。

- **Application Autofill（今後）**: 保存した申込情報を使い、Chrome拡張の `Fill Now` で現在DOMにある項目だけを意味的に検出して入力する。位置・順番や単一selectorに依存しない。
- **Offer Lab**: public/referral/targeted、ログインや通常/プライベート環境などの条件と表示オファーを比較する研究基盤。今回実装するのは安全なObservationスキーマと観測ハーネス。
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

DOMの値、全文、未知の属性文字列は保存しません。既知の項目名と完全一致する属性のみ残し、他は存在フラグにします。selectorそのものの検証は実機上で行います。`unknown` / `ambiguous` はそのまま記録し、入力対象に昇格させません。

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
```

ブラウザテストは `fixture.invalid` をPlaywright内で応答し、それ以外をabortします。CIから実Amexにはアクセスしません。`PRIVATE_SENTINEL` は除外確認用の非PII文字列で、外部へ送信されません。

## 構成・資料

- `tools/application-probe/`: 手動調査CLI、操作・通信レコーダー、安全なレポート
- `packages/core/`: URL parser、allow-list投影、DOM候補識別、厳格なschema
- `apps/extension/`: 将来のMV3拡張の責務のみ。ロード可能な拡張はまだない
- [REQUIREMENTS](docs/REQUIREMENTS.md): スコープ、MVP、非機能要件
- [ARCHITECTURE](docs/ARCHITECTURE.md): 構成とデータフロー
- [RESEARCH](docs/RESEARCH.md): Confirmed / Probable / Hypothesis / Unknownと実機手順
- [SAFETY](docs/SAFETY.md): 保存禁止・調査境界

旧Selenium、Discord、proxy/stealth設定、rawページdump、Python CI、Dockerを撤去しました。MIT LICENSEは保持しています。既存の無視対象 `.env` / `runs` / browser関連データは読み込まず、移行・削除していません。
