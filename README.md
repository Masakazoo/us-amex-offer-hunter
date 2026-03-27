# US Amex Offer Hunter

Amex Business Platinum などの **高額オファー（例: 300k / 250k ポイント）を自動検知し、「どの条件で当たりやすいか」を実験・可視化するためのツールキット** です。

- Selenium を用いた Amex オファーページのスクレイピング
- Discord へのヒット通知
- 今後の拡張として ProxyManager / StatsEngine / Dash UI を備えた実験プラットフォーム化を目指しています

詳細な設計とロードマップは以下を参照してください。

- システム設計: `docs/DESIGN.md`
- 開発ロードマップ: `docs/ROADMAP.md`

---

## セットアップ

前提:

- Python 3.12
- `uv`（推奨）または通常の `pip`

### 1. 仮想環境の作成と有効化

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
```

### 2. 依存インストール

```bash
make install-dev
```

- `requirements.txt` のインストール
- パッケージ本体の editable インストール (`pip install -e .`)

### 3. Docker / DevContainer（任意）

`Dockerfile` と `docker-compose.yml` は DevContainer 用です。  
通常のローカル検証（`make verify-*`）は `.venv` 運用で問題ありません。

---

## 設定（config.yaml + .env）

設定は **`config.yaml`（非秘匿）** を読み込み、秘匿値（トークン/キー）は **`.env` / 環境変数で上書き**します。雛形として `config.yaml` と `.env.sample` を用意しています。

```bash
cp .env.sample .env
```

### config.yaml（非秘匿）

`config.yaml` には URL や targets などの「秘匿ではない設定」を置きます。

### .env（秘匿）

`.env` には秘匿値だけを設定します（例）:

```env
US_AMEX_OFFER_HUNTER_CONFIG__PROXIES__API_KEY=YOUR_PROXY_API_KEY
US_AMEX_OFFER_HUNTER_CONFIG__DISCORD__BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN
```

### config.yaml を上書きする例（配列 / プレースホルダ）

`config.yaml` の `urls` や `discord.channel_id` は ENV でも上書きできます。`urls` は JSON 配列文字列として渡してください。

```env
# URL一覧（JSON配列文字列）
US_AMEX_OFFER_HUNTER_CONFIG__URLS=["https://example.com"]

# 通知先チャンネル（必要なら）
US_AMEX_OFFER_HUNTER_CONFIG__DISCORD__CHANNEL_ID=1307613131626905712
```

> ⚠️ Discord Bot Token や Proxy API Key は **必ず `.env` のみに記述**し、リポジトリには含めないでください。

---

## 実行方法

### 1. 単発のオファーチェック（MVP）

今後 `run_once` 向けの CLI ラッパを整備予定ですが、現時点では以下のようなイメージです:

```bash
python -m us_amex_offer_hunter.cli.main
```

`config.yaml`（必要に応じて `.env` 上書き）に基づき、Amex ページを 1 巡し、ヒットがあれば Discord に通知します。

### 2. Discord テスト通知

Bot とチャンネルの設定が正しければ、次のコマンドでテスト通知を 1 通送れます。

```bash
python -m us_amex_offer_hunter.cli.main --notify-test
```

Discord の対象チャンネルに「Amex Offer Hunter Discord test notification」が届けば、通知経路は正常です。

### 3. 検証専用モード（非通知）

BAN リスクを抑えた段階検証向けに、通知なしで URL 訪問と金額抽出だけを確認できます。

```bash
# 1回だけ検証
make verify-once

# 低頻度ループ検証（既定: 5回、45秒間隔）
make verify-loop
```

CLI 直実行の場合:

```bash
python -m us_amex_offer_hunter.cli.main --verify-once
python -m us_amex_offer_hunter.cli.main --verify-loop --iterations 5 --interval-sec 45
```

検証結果は `runs/verify_amounts.jsonl` に JSONL 形式で追記されます。

---

## 品質チェック（format / lint / test 一括）

`Makefile` によって、フォーマット・Lint・型チェック・テストを一括で実行できます。

```bash
make check
```

内訳:

- `ruff format` によるコード整形
- `ruff` による Lint
- `mypy --strict` による型チェック
- `pytest` によるテスト実行

CI でもこのコマンドをベースにチェックを行う想定です。

---

## 開発の次のステップ

高レベルな開発計画は `docs/ROADMAP.md` に詳述していますが、直近の主なトピックは次の通りです。

- SeleniumCore の強化（タイムアウト / リトライ / UA 切り替え）
- ProxyManager の実装と IP ローテーション実験
- StatsEngine / ExperimentRunner による「条件ごとの勝率」計測と検定
- Dash UI による実験結果の可視化

詳細は設計書とロードマップを参照しつつ、段階的に実装を進めていきます。

