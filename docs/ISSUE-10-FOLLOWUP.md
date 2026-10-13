# Issue #10 初回再確認・後続への判断資料

以下は2026-10-13の追加検証前の記録。**その後ユーザーが基本設計を承認し、通常Chromeで再読込・再起動等を検証済み**。現在の結果と後続の境界は [CHROME-VALIDATION.md](CHROME-VALIDATION.md) を優先する。本書のラベル照合は引き続き#12への引き継ぎに使う。

2026-10-13。既存PR #18のhead `1ea6bb67e446ec64451b72a82c6708f17cdf9aa0` を再確認。暗号設計の正本は [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md)。本書は日英ラベル照合と残る判断事項を補う。#11以降の本実装は行わない。

## 現在の合意と成果物

- PR #8はすでに未マージでClose済み。今回ユーザーに確認し、その状態と移植元ブランチを維持する。
- UXは「Popup起動時に対象判定 → 必要なら解除 → 本人が自動入力 → 再検証・入力 → 結果」。解除だけでは入力しないことを今回再確認した。
- Issue #10用のPR #18がすでにあるため、同じIssueのPRを重複作成しない。#10は未完了、#11は未承認。
- 実プロフィール、DMG、実パスワード、実Amexフォームにはアクセスしない。

## ラベルの照合

移植元: PR #8固定commit `3150ba6b51836ac037e73737cc122cad992c81af` の `fullFieldSpecs` と `profile.ts`。根拠: [RESEARCHの画面・DOM表](RESEARCH.md#画面dom)（2026-10-08の30項目）と末尾の7項目再観測。

「記録あり」は過去の英語表示の観測であり、現在の全分岐・selector・入力成功の保証ではない。日本語は説明案。英語が同じでも事業住所と自宅住所のkeyを混同しない。表の区分説明は英語ラベルの一部ではない。

| key                    | 日本語の説明案           | PR #8の英語ラベル                                  | 実測記録                    |
| ---------------------- | ------------------------ | -------------------------------------------------- | --------------------------- |
| cardDesign             | カードデザイン           | Card design                                        | 未確認（radioの用途未確定） |
| cardMaterial           | カード素材               | Card material                                      | 未確認（radioの用途未確定） |
| email                  | メールアドレス           | Email Address                                      | 記録あり・再観測あり        |
| legalBusinessName      | 正式な事業名             | Legal Business Name                                | 記録あり・再観測あり        |
| businessNameOnCard     | カードに表示する事業名   | Business Name on Card                              | 記録あり・再観測あり        |
| companyDBAName         | DBA（屋号）              | Company DBA Name                                   | 記録あり・再観測あり        |
| firstName              | 名                       | First Name                                         | 記録あり・再観測あり        |
| lastName               | 姓                       | Last Name                                          | 記録あり・再観測あり        |
| nameOnCard             | カードに表示する氏名     | Name on Card                                       | 記録あり・再観測あり        |
| companyStructure       | 事業形態                 | Company Structure                                  | 記録あり                    |
| doingBusinessAs        | DBA（屋号）はない        | Company does not have a DBA                        | 記録あり・id未確認          |
| businessAddressLine1   | 事業住所（番地・通り）   | Business Address Line 1                            | 記録あり                    |
| businessAddressLine2   | 事業住所（部屋番号など） | Business Address Line 2                            | 記録あり                    |
| businessZipCode        | 事業住所の郵便番号       | Zip Code                                           | 記録あり                    |
| businessCity           | 事業住所の市             | City                                               | 未確認                      |
| businessState          | 事業住所の州             | State                                              | 未確認                      |
| businessPhoneNumber    | 事業の電話番号           | Business Phone Number                              | 記録あり                    |
| industryType           | 業種                     | Industry Type                                      | 記録あり                    |
| yearsInBusiness        | 営業年数                 | Years in Business                                  | 記録あり                    |
| numberOfEmployees      | 従業員数                 | Number of Employees                                | 記録あり                    |
| annualBusinessRevenue  | 年間事業売上             | Gross Annual Business Revenue                      | 記録あり・id未確認          |
| estimatedMonthlySpend  | 月間利用見込額           | Estimated Monthly Spend                            | 記録あり                    |
| federalTaxId           | 事業の納税者番号         | Federal Tax ID                                     | 記録あり                    |
| roleInCompany          | 会社での役職             | Role in Company                                    | 記録あり                    |
| middleName             | ミドルイニシャル         | M.I.                                               | 記録あり・id未確認          |
| sameAddress            | 自宅住所は事業住所と同じ | My home address is the same as my business address | 記録あり                    |
| addressLine1           | 自宅住所（番地・通り）   | Home Address Line 1                                | 記録あり・id未確認          |
| addressLine2           | 自宅住所（部屋番号など） | Home Address Line 2                                | 記録あり・id未確認          |
| zipCode                | 自宅住所の郵便番号       | Zip Code                                           | 記録あり・id未確認          |
| city                   | 自宅住所の市             | City                                               | 未確認                      |
| state                  | 自宅住所の州             | State                                              | 未確認                      |
| cellPhone              | 携帯電話番号             | Cell Phone Number                                  | 記録あり・id未確認          |
| ssn                    | 社会保障番号             | Social Security Number                             | 記録あり                    |
| dateOfBirth            | 生年月日                 | Date Of Birth (MM-DD-YYYY)                         | 記録あり                    |
| totalAnnualIncome      | 年間総収入               | Total Annual Income                                | 記録あり                    |
| nonTaxableAnnualIncome | 年間非課税収入           | Non-taxable Annual Income                          | 記録あり                    |

計36項目中30項目に過去のラベル記録があり、6項目は未確認。未確認ラベルは公式表記として採用しない。#12では確認済み項目を日英併記し、未確認6項目には「実画面の英語表記は未確認」と表示する。2026-10-13にユーザーが、候補値を維持して未確認と明示する方針を承認した。選択肢一覧も未確認と表示し、日本語の補助説明は保存する英語値と分離する。実装と検証は [設定画面の契約](PROFILE-SETTINGS.md) を参照。新たな実サイト調査は本作業では行っていない。

### 選択肢とvalidationの注意

RESEARCHにはselectを開いた記録はあるが、英語選択肢の一覧を確認した記録はない。PR #8の選択肢は実装候補であって、全選択肢の公式性を証明しない。

| 対象                        | PR #8の原文例                                             | 日本語補助説明の案・後続対応                                                   |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Company Structure           | Corporation / Partnership / Sole Proprietorship           | 法人 / パートナーシップ / 個人事業主。英語値を維持し、意味・実画面の一覧を確認 |
| Industry Type               | Agriculture / Finance/Real Estate / Other 等10件          | 農業 / 金融・不動産 / その他。全10件の表示・値を確認してから訳語を確定         |
| Years in Business           | Less than one year / 1-2 years 等7件                      | 1年未満 / 1〜2年。全区間と境界を原文に一致させる                               |
| Role in Company             | General Manager / Owner / Other Authorizing Officer 等7件 | 総責任者 / 所有者 / その他の権限を持つ役員。職位を同一視せず全一覧を確認       |
| State（事業・自宅）         | 州・準州・軍用等の略号                                    | PR #8の共通配列。実DOMの対象範囲・valueは未確認。表示用説明と保存値を分離      |
| Card design / Card material | Classic / Mirror、Metal / 85% Recycled Plastic            | クラシック / ミラー、金属 / 再生プラスチック85%。ラベル・選択肢とも未確認      |
| DBAなし / 住所同一          | yes / no                                                  | PR #8内部の状態値。Amex上の英語選択肢と誤表示しない                            |

`federalTaxId` はPR #8のmax=11に対し観測HTML maxlength=9。電話・ZIP・生年月日のmaxにはschema側の制限とHTML側の制限の差がある。ラベル一致だけで仕様一致とは扱わず、#12の入力整形と#13のDOMガードを合わせて確認する。個人事業主の業種制約やDBA/住所同一の条件分岐も、既存コードと合成テストを再利用しつつ、実サイトの全分岐を確認済みとはしない。

## 今回の再検証結果

- `npm run check`: lint、typecheck、47 unit tests、既存ファイルのformatをすべて通過。追加した本資料もPrettierで整形し、`git diff --check`を通過。
- `npm run test:security`: 新規一時profileのBrave 148、headless実MV3で実行。sandbox内の起動は失敗したが、sandbox外の同じ合成テストは実行できた。
- 暗号文のみのlocal保存・sync空、誤PW拒否、明示的use、CryptoKeyのJSON保存不可、拡張document再生成、Worker強制停止後の解除保持、手動ロック、OFF競合で1回のみ成功、commit前障害時の旧レコード保持、2windowのPW変更競合、旧PW/revision拒否、browser process再起動後の再認証、改ざん拒否、破損schemaの初期化を再確認。
- unlock往復5回は40/39/39/41/40 ms。単一端末の参考値であり、低速端末への保証ではない。
- **拡張再読込は今回もUNKNOWN**。command-line-loaded extensionがブロックされるため、session消失の実測を完了できていない。テスト終了0を全DoD合格と扱わない。通常Chromeの実機検証と独立レビューも未完了。

## 本実装前の技術判断

推奨アーキテクチャは既存設計書の通り。PBKDF2-HMAC-SHA-256 600,000回で鍵導出、AES-256-GCM、localに暗号文と公開メタデータ、sessionに解除中の鍵素材のみ、Workerが要求を処理する。sessionは暗号化された保管庫ではなく、解除中の復号能力そのものを保持する。端末侵害やDevToolsからの取得を防ぐものではない。

[Chrome Storage公式](https://developer.chrome.com/docs/extensions/reference/api/storage)を2026-10-13に再確認。sessionはメモリ保持で、再起動・無効化・再読込・更新で消える仕様。実測と仕様を区別し、通常ChromeのGUI終了、背景実行、更新、実Popup、自然idle停止の未確認を残す。全ウィンドウ閉鎖とプロセス終了は同義ではない。

既存PoCは短い直列要求の検証であり、長いAutofill中の手動ロック、旧要求の再実行、session API故障、保存完了直後の応答消失までは証明していない。#11ではepochと操作ID、read-backとCOMMIT_UNKNOWN、失敗時の拒否を必須とする。鍵素材の一時保持方式と残余リスクは設計承認を受ける。

旧DMGは本人による再登録を最小案として推奨するが、移行方式は未承認。一回限り読取専用インポートを選ぶ場合も、本人が開いたファイルを選択し、メモリ内parse・validation・暗号化を行う案を比較する。Native Messagingは必須と仮定しない。実データの開封・削除・変換は別途本人判断。

## 最小PR順序

| Issue        | 変更範囲・候補ファイル                                                                                          | 完了境界                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| #10 / PR #18 | 設計資料、`tools/security-spike/`、合成検証                                                                     | 未確認のChrome検証を完了し、本人が設計を確認。本番層へ進む承認とは別    |
| #11          | `apps/extension/src/`の暗号・保存・session・worker契約、`full-profile.ts`と依存schemaの選択移植、unit/MV3 tests | 保存・解除・変更・初期化・競合/障害処理。UI・実フォーム入力を追加しない |
| #12          | 設定タブHTML/CSS/TS、ラベルと選択肢の出典対応、manifest/options導線、設定画面tests                              | 全項目の日英併記、マスク、編集、PW変更/初期化確認。#11依存              |
| #13          | Popup、Worker操作所有、`full-autofill.ts`/`target.ts`移植、合成フォームtests                                    | 明示入力、DOM/document再検証、既存値保持、非秘密の結果保持。#11/#12依存 |

#16で統合・移行確認と旧経路の整理を判断。#14の他カード調査と#15の自動PopupはMustの後続。各PRは独立レビュー、人間のマージ判断。現時点では#11以降へ進まない。
