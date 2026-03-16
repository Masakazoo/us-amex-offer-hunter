# Amex Offer Hunter – 会話サマリ & ネクストアクション

## ここまで決まったこと

- **プロジェクト名 / リポジトリ**
  - GitHub: `us-amex-offer-hunter`
  - Python パッケージ: `us_amex_offer_hunter`
  - CLI エントリポイント: `us-amex-offer-hunter`

- **設計方針**
  - ベースは `karaage0703/python-boilerplate` / python-boilerplate-llm の構造。
  - ただし **「構造厳守」ではなく**、Amex Offer Hunter にとってより良いベストプラクティスがあれば **積極的に提案・採用してよい**。
  - 型ヒント 100%・docstring 必須・pytest カバレッジ 80% 目標。
  - 設定は `config.yaml` を単一ソースとし、pydantic Settings でロード。
  - ログは `structlog`、例外はキャッチして通知レイヤに流せる設計。
  - プロキシ関連エラー時は最低 3 回の自動リトライ。

- **通知チャネル**
  - **MVP では Discord のみ実装**。
  - 設計としては `NotifierProtocol` を定義し、将来 `TelegramNotifier` を追加しやすくする。
  - `config.yaml` には `discord` は必須、`telegram` はオプションとして受け入れ可能。

- **現在の技術スタック**
  - Python 3.12 前提。
  - 主要ライブラリ:
    - `selenium`
    - `pydantic-settings`
    - `structlog`
    - `pandas`
    - `plotly`
    - `apscheduler`
    - `discord.py`
  - 開発ツール:
    - `pytest`, `pytest-cov`
    - `mypy` (strict)
    - `black`, `isort`

- **すでに実装済みの主なコンポーネント**
  - `pyproject.toml`, `requirements.txt`, `.cursorrules`
  - `config.yaml`（Discord 必須 / Telegram オプション）
  - `src/core/settings.py`（pydantic Settings + YAML ロード）
  - `src/core/__init__.py`（エイリアスレイヤ）
  - `src/us_amex_offer_hunter/core/engine.py`
    - `SeleniumEngine`（headless Chrome、プロキシ統合用フックあり）
    - `OfferDetector` / `OfferResult`
  - `src/us_amex_offer_hunter/notifier/base.py`（`NotifierProtocol`）
  - `src/us_amex_offer_hunter/notifier/discord_bot.py`（リトライ 3 回付き DiscordNotifier）
  - `src/us_amex_offer_hunter/cli/main.py`（`run_once`, `app`）
  - テスト:
    - `tests/test_settings.py`
    - `tests/test_selenium.py`
    - `tests/test_notifier_discord.py`

## 今後の大きなネクストアクション

1. **SeleniumCore の強化**
   - Amex Business Platinum 300k / 250k オファーの DOM 構造を踏まえた、安定したセレクタとパーサを実装。
   - タイムアウト・リトライ・user-agent 切り替えなどを `SeleniumEngine` に統合。

2. **ProxyManager の実装（`src/proxy/proxy_manager.py`）**
   - ProxyRack API から動的に IP を取得し、ヘルスチェック（レスポンス時間 / 成功率）を行う。
   - `SeleniumEngine` にプロキシ情報を差し込むためのインターフェースを定義。
   - プロキシエラー時の 3 回リトライロジックをここで集中管理。

3. **StatsEngine / ExperimentRunner**
   - SQLite へ試行履歴を永続化（URL, IP/UA, 時刻, 結果, オファー額など）。
   - Pandas で勝率集計（Proxy ON/OFF, UA 固定 vs ランダム, 間隔 3s vs 7s, 地域 IP）を計算。
   - A/B テスト用に「実験条件」を定義する `ExperimentRunner` を設計。
   - t 検定（p 値）による有意差検証のユーティリティを実装。

4. **DashUI（`app.py`）**
   - Plotly Dash でリアルタイムダッシュボードを構築。
   - 勝率推移グラフ・条件別比較・最新ヒット一覧などを表示。

5. **TelegramNotifier（将来オプション）**
   - `NotifierProtocol` を実装する `TelegramNotifier` を追加。
   - config.yaml の `telegram` セクションを有効化した場合のみ動作させる。
   - Discord / Telegram の両方に同時通知できるよう、ラッパーを用意しても良い。

## この会話を別フォルダから参照する方法

- **プランファイル参照**
  - この会話の要約と設計方針は、プランファイル `amex-offer-hunter-bootstrap_8ac8b307.plan.md` に整理されている。
  - 別フォルダで作業するときは、プロンプトで  
    `@amex-offer-hunter-bootstrap_8ac8b307.plan.md`  
    を付けて呼び出せば、同じ設計方針を前提にして続きから実装できる。

- **本ファイルの使い方**
  - `CONVERSATION_NOTES.md` を開けば、「ここまで何を決めたか / どこまで実装したか / 次に何をやるか」を素早く確認できる。
  - 必要に応じて、このファイルに自分でメモを書き足していく運用もおすすめ。

