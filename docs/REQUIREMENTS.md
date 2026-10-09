# Requirements

## 目的

A: 保管庫の全申込項目を入力・選択するChrome MV3拡張。実フォームの検出とオフライン全項目試験は確認済み。全項目版での実入力は本人から成功報告済み。v0.6.0ではNative Messaging読込を実装・登録したが、実機でパスワード入力後に結果が分からない問題が未解決。現在は[設計見直し用draft](AUTOFILL-REDESIGN.md)。
B: Welcome Offerの提示条件を、PIIを持たないObservationとして比較するOffer Lab。観測基盤は実装済み、高額オファー判定機能は未実装。

v0.6.0は、パスワード入力だけで暗号化保管庫を解除・読込・自動取り出しするmacOS/Chrome用補助プログラムを追加。オファー探索の自動巡回、申込送信は含めない。

## Functional requirements

| ID  | 要件                                                                                   | 今回の状態                                                                          |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| F1  | TypeScript/Node構成へ再編、旧実装撤去                                                  | 実装                                                                                |
| F2  | 操作とNetworkの時系列対応、無通信区間の明示                                            | 人間のfocus/input/change/blurとopen/inspect/idle/navigationを記録                   |
| F3  | 通信のtimestamp、URL、host/path、method、status、resource type、step、timing、sequence | URLは安全なalias、initiatorは未取得を明示                                           |
| F4  | 現在DOMの項目調査、複数の意味的識別候補                                                | 実測23組のid/name候補。拡張は確認済み全項目を固定申込pathで検出。ローカルはテスト用 |
| F5  | application code parser / Observation runtime validation                               | 単一query優先、未指定時はpathname末尾。意味・公式書式は未確認                       |
| F6  | 安全なレポート                                                                         | strict schemaを通したJSONと操作別Markdown                                           |
| F7  | 外部送信が疑われる入力項目の記録                                                       | input/change/blur区間に通信がある項目を保守的にrequires-real-user-data              |
| F8  | 保存情報からのAutofill / ローカルprofile管理                                           | 実Amexはstorage.sessionの保管庫profile、ローカルテストはstorage.local               |
| F9  | offer/campaign/treatment等の抽出                                                       | 未確認なので未実装。body収集もなし                                                  |

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

申込送信、カード承諾、CAPTCHA/anti-bot回避、fingerprint偽装、proxy rotation、他人のsession取得、partner APIの実行、hidden APIの直接呼出し、raw HAR/スクリーンショット/trace、PII fixture、実Amex CI。

## 現MVPの完了条件

ローカルの実MV3で保存・再利用・全削除と明示Fill Nowが動き、曖昧・非表示・無効・既存値・対象外・ページ変更を保守的に拒否すること。
全項目の値の正しさ・サーバー受理、本人環境でのNative Messaging読込、Offer Lab拡張、Phase 2A DOM取得失敗の解決は別の未確認・未完了項目。詳細は[拡張手順](../apps/extension/README.md)。
