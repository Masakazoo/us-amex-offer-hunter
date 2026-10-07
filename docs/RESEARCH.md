# Research log

更新日: 2026-10-07（Asia/Tokyo）。実Amex申込フォームの調査はユーザー判断で今回後送り。以下は公開資料・コード・ローカル模擬ページの結果であり、実申込での結果ではない。

## Confirmed

- Amex公式の[Targeted Offers Node SDK](https://github.com/americanexpress/targeted-offers-client)はpartner向けの事前資格判定オファー取得を説明し、Amexとの資格情報・証明書設定を前提としている。
- SDKにはofferの提示通知とsession token取得が別にある。applicant request tracking IDはこの文脈で使われるので、単に安全な分析IDとは扱わない。
- 公式developer portalの[API overview](https://developer.americanexpress.com/products/targeted-offers/overview)は今回403で取得できなかった。API詳細の最新性・全項目の意味は再検証できていない。APIは呼び出していない。
- 旧repositoryはSelenium、Discord、automation flag抑制、raw HTML/body dump、UA上書き、proxy構想を含んでいた。Phase 0で撤去し、ライセンスを維持した。
- 新probeの検証はローカル合成ページのみ。実Amexのfield/selector/通信endpointを確認済みとする資料はない。

### ローカル検証で確認したこと

32件のunit testsでURL parser、allow-list投影、nested schema、機微フィールド拒否、開始時刻による対応付けを確認。Braveのローカル模擬ページではfocus/input/blurとPOST、status/timing、requires-real-user-data判定、sentinel除外を検証した。これは実Amexの挙動の証拠ではない。

## ユーザー提供の既存調査（今回の独立検証とは分離）

Amex Targeted Offers APIには以下が定義されているとの調査情報を受領した。

| 項目群              | 提供された知見                                                                                     | 今回の保存方針                                 |
| ------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| application context | session_id / referring_url / user_session_status                                                   | session IDは保存せず、referrerもalias化が必要  |
| user session status | AUTHENTICATED / NOT_AUTHENTICATED / WARM_COOKIED                                                   | 直販画面との対応はUnknown                      |
| environment         | user_agent / IP / inferred geo ZIP / screen resolution / browser area / private_browsing_indicator | IP/ZIPは保存しない。UA等の意味は要再検証       |
| applicant/customer  | applicant/customer information / customer_flag                                                     | 個人データは保存禁止                           |
| experiment          | control_group_id                                                                                   | 直販の実験割付と同一か不明                     |
| offer / tracking    | offer information / applicant_request_tracking_id                                                  | 認証・個人との関係を確認するまで自動保存しない |

この一覧は「partner仕様についての受領情報」であり、現在のBusiness Platinum直販フォームが同じ内部API・判定ロジックを利用するという証拠ではない。

## Probable

現時点で採用する主張なし。もっともらしいという理由だけでConfirmedへ昇格させない。

## Hypothesis

- source URL、正規のsession状態、実ブラウザ環境で表示オファーが変わる可能性がある。
- blur/changeに紐づくvalidation通信がある可能性がある。
- ログイン済みでは一部の申込項目が省略される可能性がある。

いずれも今回未検証。300k / 250k / 200kが現在提示されるという主張でもない。高額オファーや承認を保証しない。

## Unknown

現行直販フォームのDOM、application code（例 `68443-9-0`）の実際のquery key/意味、offer/campaign/acquisition/treatment ID、各fieldのvalidationとNetwork時点、PUJ/eligibility/approval、private browsingの検出・利用、partner仕様との共通性。

### 項目別調査表

下表の項目名は依頼に基づく候補。実際の表示ラベルではない。**全行の実label / element / name / id / autocomplete / aria / selector / required / validation / Network timingはUnknown**。順序や存在を仮定しない。

| 区分     | 候補項目                      | 実DOM・通信 |
| -------- | ----------------------------- | ----------- |
| Business | Email Address                 | Unknown     |
| Business | Legal Business Name           | Unknown     |
| Business | DBA Name                      | Unknown     |
| Business | No DBA                        | Unknown     |
| Business | Business Name on Card         | Unknown     |
| Business | Business Address Line 1       | Unknown     |
| Business | Business Address Line 2       | Unknown     |
| Business | ZIP Code                      | Unknown     |
| Business | Business Phone                | Unknown     |
| Business | Industry Type                 | Unknown     |
| Business | Company Structure             | Unknown     |
| Business | Years in Business             | Unknown     |
| Business | Number of Employees           | Unknown     |
| Business | Gross Annual Business Revenue | Unknown     |
| Business | Estimated Monthly Spend       | Unknown     |
| Business | Federal Tax ID                | Unknown     |
| Business | Role in Company               | Unknown     |
| Personal | First Name                    | Unknown     |
| Personal | Middle Initial                | Unknown     |
| Personal | Last Name                     | Unknown     |
| Personal | Name on Card                  | Unknown     |
| Personal | Home address same as business | Unknown     |
| Personal | Home Address                  | Unknown     |
| Personal | ZIP                           | Unknown     |
| Personal | Home Phone                    | Unknown     |
| Personal | Cell Phone                    | Unknown     |
| Personal | SSN                           | Unknown     |
| Personal | Date of Birth                 | Unknown     |
| Personal | Total Annual Income           | Unknown     |
| Personal | Non-Taxable Annual Income     | Unknown     |
| Personal | Send Bill To                  | Unknown     |

調査後は各行について以下の列を作り、PIIを含まない固定文字列のみ明示レビューして記載する。

`候補項目 | 確認日時/条件 | 実label | element/type | name | id | autocomplete | aria | selector候補（複数） | required/optional | client validation | Network送信時点 | evidence / certainty`

DOMに存在しない場合は「当該条件では未表示」と記録し、一般的な不存在とはしない。未知の属性は現在のexportでは存在フラグしか残らないため、実機のDevToolsでメモリ上の値を確認し、安全な固定属性だけを人間が転記する。

## 次の実機手順

1. 公開申込URLと対象商品、source条件を選び、公開URLで秘密がないことを確認する。referral/targetedの個人tokenは保存しない。
2. READMEに従って新規Brave contextで開始。これは普段のログイン済み環境と別条件であり、通常/プライベート比較を実施したとは扱わない。
3. 初期表示を `inspect`。値を入力せず、name/id/autocomplete/aria-label/label/placeholderを複数観点で確認。CAPTCHAなら中止。
4. `idle` で背景通信を観察。その後、一項目ずつfocusし、無入力のblurを観測する。動的に出現した項目は再inspect。
5. 送信が疑われる操作はrequires-real-user-dataとして扱う。ダミー値では進めない。client validationの入力検証は本人の実データ判断またはローカル再現で行う。
6. request開始sequenceとstatus/timingを比較する。alias化されたrouteは同じrun内の比較用。実pathを安全と明示判断できた場合のみ将来の固定allow-list候補にする。
7. finishで保存。手作業で安全な観測結果のみを本書へ追記し、証拠のない欄はUnknownを維持する。

必要な観測データ: UTC時刻、商品/source、実ブラウザ/viewport/session条件、実表示ポイントの数値と表示文脈の確認、項目存在、固定selector候補、validation種別、step/通信sequenceと時刻、条件差と反復数。PIIやtokenは一切不要。

## Autofillへ進む判定

**調査開始は可能、Amex固有Autofill実装の準備は未完了。** 実DOMの複数selector、重複/省略項目、既存値の扱い、送信契機、custom controlsの確認を先に行う。申込確定操作を実装しない境界は維持する。
