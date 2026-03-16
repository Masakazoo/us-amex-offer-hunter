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

---

## 設定（.env）

設定は **`.env` / 環境変数のみ** から読み込みます。雛形として `.env.sample` を用意しています。

```bash
cp .env.sample .env
```

`.env` には少なくとも以下を設定します:

```env
US_AMEX_OFFER_HUNTER_CONFIG__PROXIES__PROVIDER=proxyrack
US_AMEX_OFFER_HUNTER_CONFIG__PROXIES__API_KEY=YOUR_PROXY_API_KEY
US_AMEX_OFFER_HUNTER_CONFIG__PROXIES__COUNTRY=US
US_AMEX_OFFER_HUNTER_CONFIG__DISCORD__BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN
US_AMEX_OFFER_HUNTER_CONFIG__DISCORD__CHANNEL_ID=YOUR_DISCORD_CHANNEL_ID
US_AMEX_OFFER_HUNTER_CONFIG__URLS__0=https://example.com
US_AMEX_OFFER_HUNTER_CONFIG__TARGETS__0=300000
```

> ⚠️ Discord Bot Token や Proxy API Key は **必ず `.env` のみに記述**し、リポジトリには含めないでください。

---

## 実行方法

### 1. 単発のオファーチェック（MVP）

今後 `run_once` 向けの CLI ラッパを整備予定ですが、現時点では以下のようなイメージです:

```bash
python -m us_amex_offer_hunter.cli.main
```

`.env` で指定した `URLS` / `TARGETS` に基づき、Amex ページを 1 巡し、ヒットがあれば Discord に通知します。

### 2. Discord テスト通知

Bot とチャンネルの設定が正しければ、次のコマンドでテスト通知を 1 通送れます。

```bash
python -m us_amex_offer_hunter.cli.main --notify-test
```

Discord の対象チャンネルに「Amex Offer Hunter Discord test notification」が届けば、通知経路は正常です。

---

## 品質チェック（format / lint / test 一括）

`Makefile` によって、フォーマット・Lint・型チェック・テストを一括で実行できます。

```bash
make check
```

内訳:

- `black` / `isort` によるコード整形
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

