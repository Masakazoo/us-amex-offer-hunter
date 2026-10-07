# US Amex Application Support / Offer Lab

US American Express申込を人間が管理しながら支援するための調査プロジェクトです。
現在は **Phase 0（再構築） / Phase 1（application-probe MVP）**。完成したAutofill拡張ではありません。

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

## 実フォーム調査の開始（今回は未実施）

1. [SAFETY](docs/SAFETY.md)と[調査手順](docs/RESEARCH.md)を読む。
2. 個人情報やtokenを含まない、使用対象の公開HTTPS URLを `PROBE_URL` 環境変数に設定する。許可する初期hostは `www.americanexpress.com` のみ。秘密のURLをシェル履歴へ貼らない。
3. `npm run probe` を実行する。新規の隔離browser contextが開く。普段のprofileやCookieは読み込まない。
4. ターミナルで `inspect` を実行し、存在するフォーム項目の安全なメタデータを確認する。ブラウザで人間がfocus等を操作する。**ダミー入力はしない**。
5. `idle` で無操作の比較区間を開始する。次の操作までは一つの区間となる。
6. `finish` またはCtrl+Cでブラウザを閉じ、`runs/probe-<UUID>/observation.json` と `steps.md` を保存する。通常EOFでも保存する。強制終了・クラッシュ時の回復は未対応。

probeはURLを開く以外の操作を実行しません。ページ遷移は人間が行い、Submit/Acceptには進まないでください。実データを入力する検証は本人による別途明示判断が必要です。CLIへ自由文やPIIを入力しないでください。

### 保存される情報と制約

URL query/fragment/credentialsは保存しません。未知hostは `host-1`、未知pathは `/route-1` のような実行内aliasへ変換します。alias対応表はメモリのみ。実URLをGit管理する必要はありません。

DOMの値、全文、未知の属性文字列は保存しません。既知の項目名と完全一致する属性のみ残し、他は存在フラグにします。selectorそのものの検証は実機上で行います。`unknown` / `ambiguous` はそのまま記録し、入力対象に昇格させません。

通信は開始時刻で操作と対応付けます。レスポンスが後から返っても別の操作へ付け替えません。ただし関連は **temporal-only** であり、因果関係は証明しません。通信がない区間も「その観測範囲で未観測」の意味です。詳細な計測範囲は[ARCHITECTURE](docs/ARCHITECTURE.md)参照。

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
