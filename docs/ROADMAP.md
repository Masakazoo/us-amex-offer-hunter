## Amex Offer Hunter Executive Board

このドキュメントは、開発ディレクション用の「タスク管理ボード」です。  
詳細設計は `docs/DESIGN.md` を参照し、このページでは **何をいつ進めるか**だけを管理します。

---

## 1. Board ルール

- ステータスは `NOW / NEXT / LATER / BLOCKED / DONE` の5つで管理する
- タスクは必ず `Priority / DoD` を持つ
- DoD（Definition of Done）を満たしたら `DONE` に移動する
- 実行根拠は `runs/*.jsonl` または CI 結果で残す

---

## 2. Executive Snapshot

| Track | Goal | Status | Next Milestone | Risk |
|---|---|---|---|---|
| Detection | 200k/300k 抽出の安定運用 | In Progress | 10/10 連続成功 | headless差分 |
| Operations | verify→notify運用の定着 | In Progress | 当たり時停止フロー | 誤通知 |
| Reliability | 再試行/プロキシ/耐障害性 | Not Started | ProxyManager最小版 | 実装規模 |
| Experiment | 条件比較と統計化 | Not Started | SQLite保存 | スキーマ未確定 |
| Product | 可視化とマルチ通知 | Not Started | ダッシュボード雛形 | 優先度低 |

---

## 3. NOW（今週やる）

| ID | Task | Priority | DoD | Note |
|---|---|---|---|---|
| N-01 | verify-loop の当たり時自動停止オプション実装 | P0 | `found=true` でループ停止し終了コード0 | CLI + Makefile対応 |
| N-02 | headed運用の標準手順を `README.md` に反映 | P0 | 新規メンバーが手順だけで再現可能 | `headless=false` 前提 |
| N-03 | verifyログのサマリコマンド追加（最新N件） | P1 | 1コマンドで成功率/直近amount確認 | Makefile target追加 |
| N-04 | notify本番実行前のガード（dry-run確認フロー） | P1 | 誤通知なしで切替手順が明確 | 運用ルール |
| N-05 | `make verify` の実行環境注記を docs 明記 | P1 | Cursor実行制約が明文化 | FAQ的に追記 |

---

## 4. NEXT（次スプリント）

| ID | Task | Priority | DoD | Note |
|---|---|---|---|---|
| X-01 | ProxyManager 最小実装（ローテーション + 3回リトライ） | P1 | proxy ONでverifyが継続実行可能 | .cursorrules要件対応 |
| X-02 | Seleniumのタイムアウト/再試行を設定化 | P1 | 設定だけで調整可能 | `config.yaml` 拡張 |
| X-03 | amount抽出の回帰テスト拡充（実データ準拠） | P1 | 主要フォーマット網羅 | test fixture化 |
| X-04 | 当たり検知時の通知メッセージ標準化 | P2 | URL/amount/timestamp統一 | Discord用 |
| X-05 | エラー通知経路（最低Discord）を統合 | P2 | 致命エラー時に通知される | 監視性向上 |

---

## 5. LATER（中期）

| ID | Task | Priority | DoD | Note |
|---|---|---|---|---|
| L-01 | SQLite保存（試行ログ永続化） | P2 | verify結果がDBに保存される | jsonl併用可 |
| L-02 | 条件A/B比較ランナー実装 | P2 | headless/UA/proxyの比較実行 | 実験基盤 |
| L-03 | 集計モジュール（成功率/時系列） | P2 | レポート生成可能 | pandas想定 |
| L-04 | TelegramNotifier 追加 | P3 | 設定でON/OFF可能 | NotifierProtocol準拠 |
| L-05 | Dash可視化（最小版） | P3 | ヒット率グラフ表示 | 後回し可 |

---

## 6. BLOCKED（依存待ち）

| ID | Task | Blocker | Action |
|---|---|---|---|
| B-01 | Proxyプロバイダ本番接続試験 | 実運用キー/制限確認 | キー確認後に再開 |
| B-02 | 本番通知切替 | 運用ポリシー最終確認 | 手順レビュー後に実施 |

---

## 7. DONE（完了）

| ID | Task | Evidence |
|---|---|---|
| D-01 | verify-loop の回数/間隔可変化 | `make verify-loop ITERATIONS=5 INTERVAL_SEC=5` 実行 |
| D-02 | headed + retry 抽出で 200,000 検出 | `runs/verify_amounts.jsonl` で iteration 1-5 success |
| D-03 | docs設計の現行実装反映 | `docs/DESIGN.md` 更新済み |
| D-04 | 設定に Selenium runtime 追加 | `config.yaml` + `Settings` 反映済み |

---

## 8. KPI（週次確認）

- `KPI-1`: 直近20回の `found=true` 率
- `KPI-2`: 直近20回の `amount=200000` 一致率
- `KPI-3`: verify 1回あたり平均所要時間
- `KPI-4`: 通知エラー率（notify本番化後）

---

## 9. 運用コマンド（現時点）

- 単発検証: `make verify-once`
- ループ検証: `make verify-loop ITERATIONS=5 INTERVAL_SEC=5`
- デバッグ付き: `make verify-once-dump`
- 品質チェック: `make check`

