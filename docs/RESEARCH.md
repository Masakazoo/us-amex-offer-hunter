# Research log

更新日: 2026-10-08（Asia/Tokyo）。Issue #4 / Phase 2Aの実測記録。
**主要DOMはComputer UseとDevToolsで確認できたが、probeの自動DOM取得は未解決。Issueは未完了とする。**

## 条件・証拠

PR #3を含むmain `1845aaa` から調査開始。公開Business Platinum商品ページからApplyへ進む。
全runは新規context、Service Worker allow、viewport設定1440×1000。既存profile・ログインsessionは利用していない。
Braveを優先したが、Computer Useが通常利用中のBraveプロセスを参照したため、未起動のChromeをprobe専用に起動した。
ChromeではComputer Useで同じ商品ページと申込画面を確認し、Apply・focus・Tabによるblurを実行できた。
BraveとChromeの結果は同条件の比較実験ではない。DevTools表示は実効表示領域・timingにも影響し得る。

| run | 開始UTC            | ブラウザ             | 確認内容                                                            | request数  |
| --- | ------------------ | -------------------- | ------------------------------------------------------------------- | ---------- |
| A   | 10-07 14:07:19.714 | Brave 148.0.7778.167 | 直接アクセス。ユーザー報告はセッション切れのような表示              | 804        |
| B   | 10-07 14:13:06.810 | 同上                 | 商品ページ経由。ユーザーがフォーム表示を確認、probeは累積1fieldのみ | 351        |
| D   | 10-08 11:10:54.559 | 同上                 | main frameのevaluation-failed、現URL parser成功                     | 343        |
| E   | 10-08 11:16:29.067 | 同上                 | ユーザーのEmail操作後focus 1件、blurは未記録                        | 353        |
| F   | 10-08 11:26:13.461 | Chrome 154.0.8037.98 | Computer Use + DevTools、主要DOM確認、focus/blur各47件              | 685        |
| G   | 10-08（F後）       | 同上                 | Computer Useで再遷移、現code確認、JSON転送でもDOM評価失敗           | 集計対象外 |

A/B/D/E/F/Gはfinish後のsafe JSONをstrict schemaで再検証し、Markdown再生成一致を確認。
F/Gはディレクトリ0700・両ファイル0600も確認。生のrunはGit対象外。
10-07の診断再起動試行Cは終了成果物を確認できず、証拠集計から除外した。
以下の固定DOM属性はDevToolsで許可リストへ投影した結果をレビューして転記したもの。
フォーム値、headers、Cookie、body、raw URL、query値、tokensを研究成果物へ転記しない。
HAR・trace・スクリーンショットは生成していない。ユーザー提供画像もコピーしていない。
Computer Useの自動AX応答にはURL等が含まれることがあり、probeのstrict schema保護範囲外である。
このため、生成成果物・Gitの保存境界と、ツール応答の表示を同一の保証として扱わない。

## Confirmed

### 画面・DOM

Fの同一申込画面で、DevToolsから既存 `__probeInspect` を実行すると34項目を返した。
内訳は下表の30項目と、未展開のCard design領域等に対応し得るradio 4個（用途・可視性未確定）。
main documentにはiframe 5個、native select 4個、確認できるopen shadow host 0個。
closed shadow DOMやiframe内の完全性は検証していない。

下表の `id=name` は実際に両属性がその固定値だったという意味。記載した23個すべてで
`#<id>` と `[name="<id>"]` の一致数を各1と実測した。これは複数selector候補であり、実装済みAutofillではない。
unknownは属性不存在の意味ではなく、許可リストで固定値を確認できなかったことを示す。
全30項目でdisabled=false、pattern属性なし。requiredはHTML属性であり業務上の必須性ではない。

| 実label（末尾*省略）                               | element/type               | id=name                | HTML required | maxlength            |
| -------------------------------------------------- | -------------------------- | ---------------------- | ------------- | -------------------- |
| Email Address                                      | input/text                 | email                  | false         | 50                   |
| Legal Business Name                                | input/text                 | legalBusinessName      | false         | 90                   |
| Business Name on Card                              | input/text                 | businessNameOnCard     | false         | 20                   |
| Company DBA Name                                   | input/text                 | companyDBAName         | false         | 90                   |
| Company does not have a DBA                        | input/checkbox             | unknown                | false         | なし                 |
| Business Address Line 1                            | input/text + role combobox | businessAddressLine1   | false         | 40                   |
| Business Address Line 2                            | input/text                 | businessAddressLine2   | false         | 40                   |
| Zip Code（Business）                               | input/tel                  | businessZipCode        | false         | なし                 |
| Business Phone Number                              | input/tel                  | businessPhoneNumber    | true          | なし                 |
| Industry Type                                      | select/select-one          | industryType           | true          | なし                 |
| Company Structure                                  | select/select-one          | companyStructure       | true          | なし                 |
| Years in Business                                  | select/select-one          | yearsInBusiness        | true          | なし                 |
| Number of Employees                                | input/tel                  | numberOfEmployees      | false         | 3                    |
| Gross Annual Business Revenue                      | input/text                 | unknown                | true          | 属性あり・数値未確認 |
| Estimated Monthly Spend                            | input/text                 | estimatedMonthlySpend  | false         | 11                   |
| Federal Tax ID                                     | input/password             | federalTaxId           | true          | 9                    |
| Role in Company                                    | select/select-one          | roleInCompany          | true          | なし                 |
| First Name                                         | input/text                 | firstName              | false         | 15                   |
| M.I.                                               | input/text                 | unknown                | false         | 属性あり・数値未確認 |
| Last Name                                          | input/text                 | lastName               | false         | 20                   |
| Name on Card                                       | input/text                 | nameOnCard             | false         | 20                   |
| My home address is the same as my business address | input/checkbox             | sameAddress            | false         | なし                 |
| Home Address Line 1                                | input/text、AXではcombobox | unknown                | false         | 属性あり・数値未確認 |
| Home Address Line 2                                | input/text                 | unknown                | false         | 属性あり・数値未確認 |
| Zip Code（Home）                                   | input/tel                  | unknown                | false         | なし                 |
| Cell Phone Number                                  | input/tel                  | unknown                | true          | なし                 |
| Social Security Number                             | input/password             | ssn                    | true          | 11                   |
| Date Of Birth (MM-DD-YYYY)                         | input/text                 | dateOfBirth            | true          | なし                 |
| Total Annual Income                                | input/text                 | totalAnnualIncome      | true          | 10                   |
| Non-taxable Annual Income                          | input/text                 | nonTaxableAnnualIncome | false         | 10                   |

23個の固定idに対するlabel[for]は、businessZipCode/businessPhoneNumberだけ各2、他は各1。
Zip Codeという表示名はBusiness/Homeで重複する。順番や表示名だけで入力先を決めてはいけない。
確認した23項目はplaceholderなし。estimatedMonthlySpend/totalAnnualIncome/nonTaxableAnnualIncomeには
aria-labelとaria-labelledbyがあるが、その値は未レビュー。他の20項目では両属性なし。
aria-required=trueを確認したのはbusinessAddressLine1/businessPhoneNumber/federalTaxId/ssn/dateOfBirth/totalAnnualIncome。
autocompleteはbusinessZipCodeがpostal-code、通常text/address/phone系の確認済み項目ではon。
select・checkbox・password系の正確なautocomplete値は今回の投影ではUnknown。

Emailはinput/textでHTML required=falseだが、画面では必須マークがあり、無入力blurで必須エラーが出てaria-invalid=trueになった。
値を入力するvalidationテストは未実施。checkboxを切り替えて現れるfield、住所候補選択後の動的表示、Card design選択後は未確認。
Home Phone、Send Bill Toは **not observed under this condition**。不存在とは断定しない。

画面は最大300,000ポイント・20,000 USD/最初の3か月という条件を表示した。
正確なofferは申込送信後に得る旨の案内も表示されていた。個別の確定offer・eligibility・approvalは確認していない。

### 操作とNetwork

FはComputer Useで実画面を操作したrun。probeにfocus 47件・blur 47件、各31個のfield aliasが記録された。
Tabによる次fieldのfocusや再focusも含むため、31個の別の申込項目を特定した意味ではない。
input/changeは0件。値入力・選択肢の決定・checkbox切り替え・Submit/Accept・ログイン・CAPTCHA操作は行っていない。
selectは開いてEscapeで閉じ、Tabで離れた。checkboxはShift+Tab/Tabで移動した。

F全体はGET 413 / POST 272、finished 630 / failed 10 / pending 45。
resource typeはdocument 3、stylesheet 7、script 169、image 157、xhr 240、fetch 94、font 8、other 7。
redirect linkageは72件。これらを申込ページのredirectと一括して解釈しない。
FのEmail再focus（step23、11:33:40.805Z）からblur（step24、11:33:41.812Z）の例:

| sequence | UTC（2026-10-08） | host/path alias                   | method/type | status | duration ms | originating step |
| -------- | ----------------- | --------------------------------- | ----------- | ------ | ----------- | ---------------- |
| 542      | 11:33:40.817      | www.americanexpress.com /route-40 | POST/xhr    | 201    | 475.703     | 23 focus         |
| 543      | 11:33:40.988      | host-32 /route-197                | POST/xhr    | 200    | 1403.145    | 23 focus         |
| 544      | 11:33:41.812      | www.americanexpress.com /route-40 | POST/xhr    | 201    | 291.855     | 24 blur          |

すべてtemporal-only。validation/session作成/telemetry等の用途や因果関係は未確認。
無通信区間も存在するが、短い操作区間・背景通信・遅延通信から安全性を証明できない。
scroll、DOM mutation、Apply、DevTools操作は自動step化されない。長いblur区間にはDevTools操作も混在する。
main frameの自動DOM取得失敗により、exportされたfieldsと多くのfield aliasの意味対応は未完成。
表のDOM証拠と、時系列から推測したfield対応を混同しない。

### 現URL・計測診断

Gのアドレス欄から既知書式のpath codeだけを投影し `64281-9-0` を確認した。
probeの現main-frame URLに対する既存parserも成功した。旧例 `68443-9-0` との違いを確認したが、生成規則や意味は不明。
query値・後続bodyを保存していないため、後続通信へのcode伝播はUnknown。

Brave/Chromeとも、商品ページのinspectはready、申込ページのmain frameはevaluation-failedだった。
ChromeのDevToolsではnative control数34・observer関数の存在・34項目の返却を確認した。
JSON文字列転送に変更する試行でも失敗したため、その試験変更は採用していない。
CLI診断はpage/frame、main frame、固定状態・失敗分類、件数、parser成功booleanをstrict schemaで検証して表示する。
累積fieldsは現在のDOM取得成功を意味しない。診断は既存reportへ自動保存せず、raw例外は出さない。

## Probable

採用する主張なし。DOM評価経路のどの層に問題があるかは未確定。

## Hypothesis

- 直接アクセス時には入口遷移に伴う状態が不足した可能性がある。
- URLがユニーク生成されるというユーザー仮説は未立証。codeの差だけでは証明できない。
- focus/blurに伴う通信にvalidationやtelemetryが含まれる可能性はあるが、名称・時間的一致だけで分類しない。

## Unknown / 限界

- main frame評価失敗の根本原因、反復時のselector安定性、未レビュー属性、field aliasとDOMの完全な対応。
- 入力後のvalidation、住所候補、条件分岐、既存値・重複・省略の扱い。未表示fieldはnot observed under this condition。
- iframe内の完全性、closed shadow DOM、SPA遷移と各通信の関係、SW登録・制御・response帰属。
- SW allowは完全取得を保証しない。WebSocket frame、browser内部通信、一部SW挙動、終了時イベントは対象外・未検証。
- application/session/offer/acquisition/campaign/treatment等のroute役割、code伝播、PUJ/eligibility/approval。

## DoDと次Phase

| Issue #4のDoD                       | 判定                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| 現行ページをprobeで観測             | 一部達成。Network/操作は取得、main DOM自動取得は未解決            |
| 無入力・Submit/Acceptなし           | 確認。操作履歴とinput/change 0件。技術的送信遮断の保証ではない    |
| safe report生成・保存禁止データ除外 | 生成成果物はstrict schema検証済み。Computer Use自動応答は別の境界 |
| 主要DOM・初期Network topology       | DevTools補完で主要DOMを確認。用途・frame/SW帰属はUnknown          |
| 現行実URLでparser動作               | 確認                                                              |
| RESEARCH更新・未知点明文化          | 完了                                                              |
| Autofill移行判断                    | 下記の限定提案が可能                                              |

**Phase 2B: Autofill MVPを、固定selectorを確認した単純text項目に限る設計・ローカルfixture検証として提案する。**
id/name/labelの一致と一意性、可視・有効・既存値・曖昧性のガードが必要。
実サイトへの入力開始は今回の許可に含めない。住所combobox、select、checkbox、SSN/税ID/DOB/収入等の扱いは別途確定する。
main DOM取得失敗と再現性確認が残るため、Issue #4は閉じずdraft PRとする。

**Phase 2C: Real application observation** は、本人の正しい情報と実際の申込意思がある場合だけ別途検討する。
正確なofferや送信後の判定を調べるために、今回Submit/Acceptへ進むことはしない。

## Phase 0/1からの参考知見（今回の直販実測と別）

Amex公式[Targeted Offers Node SDK](https://github.com/americanexpress/targeted-offers-client)はpartner向けで、資格情報・証明書設定を前提とする。
以前の調査では[developer portal](https://developer.americanexpress.com/products/targeted-offers/overview)は403で取得できなかった。
partnerのsession/context/offer/tracking仕様が現在の直販フォームと共通である証拠はない。APIを直接呼び出していない。
旧Selenium/stealth/proxy/raw dump等はPhase 0で撤去済み。ローカルunit/browserテストの成功は実Amex動作の証拠とは分離する。
