# Requirements

## 目的

A: 36項目をパスワードで暗号化保存し、Popupから明示的に入力するChrome MV3拡張。Business Platinumの確認済みhost/pathに限定し、合成フォームで検証。本人の実Amex適合確認は#16で別途承認を得る。
B: Welcome Offerの提示条件を、PIIを持たないObservationとして比較するOffer Lab。観測基盤は実装済み、高額オファー判定機能は未実装。

#11–#13で保管層・日英設定・Popupと全項目入力を統合。#16は製品E2E、配布物監査、本人確認と旧資産保全を扱う。オファー探索の自動巡回は含めない。

## Functional requirements

| ID  | 要件                                                                                   | 今回の状態                                                             |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| F1  | TypeScript/Node構成へ再編、旧実装撤去                                                  | 実装                                                                   |
| F2  | 操作とNetworkの時系列対応、無通信区間の明示                                            | 人間のfocus/input/change/blurとopen/inspect/idle/navigationを記録      |
| F3  | 通信のtimestamp、URL、host/path、method、status、resource type、step、timing、sequence | URLは安全なalias、initiatorは未取得を明示                              |
| F4  | 現在DOMの項目調査、複数の意味的識別候補                                                | 実測候補と未検証ラベルを区別。入力直前にDOM/文書を再検証               |
| F5  | application code parser / Observation runtime validation                               | 単一query優先、未指定時はpathname末尾。意味・公式書式は未確認          |
| F6  | 安全なレポート                                                                         | strict schemaを通したJSONと操作別Markdown                              |
| F7  | 外部送信が疑われる入力項目の記録                                                       | input/change/blur区間に通信がある項目を保守的にrequires-real-user-data |
| F8  | 保存情報からのAutofill / ローカルprofile管理                                           | 36項目を暗号化保存、Popupの明示入力・停止/結果、確認付き初期化         |
| F9  | offer/campaign/treatment等の抽出                                                       | 未確認なので未実装。body収集もなし                                     |

source条件、結果は既知のenum/数値型で将来の注釈を受け付ける。CLIはsourceをunknownにし、eligibility/PUJ/approvalを推測しない。acceptedは常にfalse。計測していない環境属性をfalse等で埋めない。

## Non-functional requirements

- Node 24、TypeScript strict、最小依存（Playwright/Zod、開発用Vitest/ESLint/Prettier/tsx/esbuild、Chrome API型定義）。UIフレームワーク不要。
- request開始時刻で対応付け、終了時にtimingを補完。redirectは別sequence。
- 未知フィールドを許可しないruntime schemaを、保存境界にも適用。
- ローカル操作、ネットワーク不要のunit tests、外部通信を拒否するbrowser smoke。
- セッション比較のため実行UUID、UTC時刻、ブラウザ、viewport、新規context、service worker設定を記録。
- 対象ブラウザはChromium系。Brave優先。Firefox/WebKit/CDP既存セッション接続は将来。

## Security / Privacy

保存禁止情報は[SAFETY](SAFETY.md)を正本とする。raw body/headersを読み出さない。自由文をログに入れない。未知URL/DOM属性は取り込まない。権限0700の実行ディレクトリ、0600の新規ファイルへ保存。ランタイム観測はGit対象外。

## Out of scope

申込送信、カード承諾、CAPTCHA/anti-bot回避、fingerprint偽装、proxy rotation、他人のsession取得、partner APIの実行、hidden APIの直接呼出し、raw HAR/スクリーンショット/trace、PII fixture、実Amex CI、実サイト検証済みChrome拡張。

## 現MVPの完了条件

実MV3で暗号化保存・再起動・解除・明示入力・結果・手動ロックが動き、曖昧・非表示・無効・既存値・対象外・ページ変更を保守的に扱う。配布・移行の条件は[実機検証と移行手順](RELEASE-AND-MIGRATION.md)を参照。
実サイト検証・Offer Lab拡張・Phase 2A DOM取得失敗の解決は別の未完了項目。詳細は[拡張手順](../apps/extension/README.md)。
