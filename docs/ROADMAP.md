## Amex Offer Hunter 開発ロードマップ

本プロジェクトのゴールは、**Amex Business Platinum などの高額オファー検知を自動化し、統計的に「どの条件で当たりやすいか」を可視化する実験プラットフォーム**を作ることです。

このドキュメントでは、MVP から実験プラットフォーム完成までのステップを段階的に整理します。

---

## 0. 現状の実装と「いま出来る実機検証」

すでに実装済みの主なコンポーネント:

- `Settings` (`src/core/settings.py`)
- `SeleniumEngine` / `OfferDetector` (`src/us_amex_offer_hunter/core/engine.py`)
- `NotifierProtocol` / `DiscordNotifier` (`src/us_amex_offer_hunter/notifier/*`)
- CLI エントリ (`src/us_amex_offer_hunter/cli/main.py`)
- 基本的な pytest テスト

**いま手元で試しておくと良い実機検証（2025-03 時点）:**

- **設定の動作確認**
  - `config.yaml` を自身の URL / targets / channel_id にあわせて調整する（秘匿は入れない）。
  - `.env` を `.env.sample` からコピーし、Bot Token / Proxy API Key などの秘匿を設定する。
  - `pytest tests/test_settings.py` で「YAML + env上書き」の設定ロードが成功することを確認する。

- **pytest による基本動作の検証**
  - `pytest -q` でユニットテストが通ることを確認する。
  - Selenium 実機ブラウザは DummyDriver で疑似化されているため、ブラウザ起動なしでロジック部分の健全性を確認可能。

- **Discord 通知の検証（トークンを設定できる場合）**
  - `.env` に実際の Discord Bot Token / Channel ID を設定。
  - `python -m us_amex_offer_hunter.cli.main --notify-test` でテスト通知が 1 通届くことを確認。
  - 低レベルのインターフェース検証としては、`pytest tests/test_notifier_discord.py -q` も併用可能（ネットワーク I/O 自体はモック前提）。

---

## 1. MVP: 手動トリガー型 Offer チェッカー + Discord 通知

**目的:**  
ローカルから手動でコマンドを叩くと、指定した Amex Offer ページにアクセスし、ターゲット金額があれば Discord に通知するところまでを完成させる。

**要素:**

- `SeleniumEngine` でヘッドレス Chrome を起動し、設定された `urls` を順番に巡回。
- `OfferDetector` がページ内容からターゲット金額 (`targets`) を検出。
- 見つかった場合、`DiscordNotifier` で指定チャンネルへ通知。
- CLI から `us-amex-offer-hunter run-once` のような単発実行コマンドで動かす。

**完了条件:**

- ローカル環境でコマンド 1 発叩くと、Amex のテスト URL（あるいはスタブページ）にアクセスし、条件にマッチした場合だけ Discord に 1 通通知される。
- すべての処理は構造化ログ（`structlog`）で追跡できる。

---

## 2. SeleniumCore 強化（タイムアウト / リトライ / UA 切り替え）

**目的:**  
Amex 側のレスポンス遅延や一時的なエラーに対して頑健に動作するよう、Selenium レイヤを強化する。

**主なタスク:**

- `SeleniumEngine` に以下のパラメータを導入（`Settings` / `.env` 連携）:
  - ページロードタイムアウト
  - 要素検出タイムアウト
  - 最大リトライ回数
  - User-Agent の候補リスト / ランダム切り替え
- Amex ページの DOM 構造を踏まえた安定セレクタの設計（実機観察に基づいて随時更新）。
- `OfferDetector` で金額抽出ロジックを強化（`300,000`, `$300k`, `300 000` などフォーマット差異への対応）。
- これら挙動をカバーするユニットテストの拡充。

**完了条件:**

- 一時的なネットワークエラーやタイムアウトで即失敗せず、規定回数リトライした上で結果を返す。
- 異なる User-Agent 条件でも安定して DOM から金額を抽出できる。

---

## 3. ProxyManager 実装（`src/proxy/proxy_manager.py`）

**目的:**  
ProxyRack などのプロキシプロバイダを抽象化し、IP ローテーションとヘルスチェックを一元管理する。

**主なタスク:**

- `ProxyManager` クラスを設計:
  - ProxyRack API からプロキシを取得。
  - レイテンシ / 成功率に基づくヘルスチェック。
  - `get_next_proxy()` で「次に使うべきプロキシ」を返すインターフェース。
- `SeleniumEngine` で「プロキシ情報を受け取って ChromeOptions に適用するフック」を実装。
- プロキシエラー検知時に、**最低 3 回の自動リトライ**を行うロジックを `ProxyManager` 側で集中管理。
- プロキシ利用有無を設定から制御可能にする。

**完了条件:**

- プロキシを ON にすると、IP ローテーションしながら Amex ページへアクセスできる。
- プロキシエラー時には、設定された回数だけ自動で別 IP でのリトライが行われる。

---

## 4. StatsEngine / ExperimentRunner（実験プラットフォーム化）

**目的:**  
「どの条件で当たりやすいか」を定量的に評価するため、試行ログを蓄積し、統計的な比較ができる状態にする。

**主なタスク:**

- SQLite ベースの簡易データベースを導入し、以下のカラムを持つテーブルを設計:
  - 実行時刻、URL、使用プロキシ/IP、User-Agent、インターバル、結果（ヒット / ミス）、オファー額、エラー情報など。
- `StatsEngine`:
  - pandas DataFrame へのロード。
  - 条件別の勝率（ヒット率）集計。
  - 時系列での勝率推移計算。
- `ExperimentRunner`:
  - 「A/B/C それぞれの条件セット」を定義し、自動で試行をスケジューリング（apscheduler）する。
  - 条件セットごとの試行結果を `StatsEngine` に渡す。
- t 検定などを用いた有意差検証ユーティリティの実装。

**完了条件:**

- 「Proxy ON vs OFF」「UA ランダム vs 固定」などの条件で勝率に差があるかを数値で比較できる。
- 少なくとも 2 群間の比較で p 値を算出し、「有意差あり / なし」の判断ができる。

---

## 5. Dash UI（`app.py`）による可視化

**目的:**  
Dashboard で実験結果をインタラクティブに閲覧できるようにする。

**主なタスク:**

- Plotly Dash ベースの Web UI を `app.py` として実装。
- 画面例:
  - 時系列での勝率推移グラフ。
  - 条件別（Proxy, UA, インターバルなど）の勝率比較バーグラフ。
  - 最新ヒット一覧（どの条件でどのオファー額が出たか）。
- SQLite / `StatsEngine` からのデータ読み込みをバックエンドで行い、Dashboard に反映。

**完了条件:**

- ローカルで `python app.py` や `uvicorn app:app` 的なコマンドを実行すると、ブラウザで統計ダッシュボードを閲覧できる。

---

## 6. 通知チャネル拡張（TelegramNotifier など）

- `NotifierProtocol` を実装する `TelegramNotifier` を追加。
- `config.yaml` の `telegram` セクションが有効な場合のみ初期化。
- Discord/Telegram 両方へのマルチキャスト通知を行うラッパーを実装する。

**完了条件:**

- 通知チャネルを設定ファイルだけで追加・無効化できる。
- 新たなチャネル追加（例: Slack）も `NotifierProtocol` 準拠で容易に行える。

---

## 7. 運用フェーズでのチェックリスト

- `pytest`, `mypy --strict`, `black`, `isort` が CI で自動実行される。
- config のバリデーションエラーは**必ず** structlog で記録され、将来的には Discord/Telegram にも通知される。
- プロキシ・Selenium・通知いずれかの障害でも、例外が握りつぶされずに必ずどこかのチャネルに届く設計になっている。

