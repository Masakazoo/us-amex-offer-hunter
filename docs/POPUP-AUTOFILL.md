# Popupと自動入力の連携 (#13)

2026-10-13。設定・暗号化保管層に接続する通常Popup。UXの正本は[AUTOFILL-UX-SPEC](AUTOFILL-UX-SPEC.md)、鍵と失効の契約は[暗号化保管層](ENCRYPTED-PROFILE-STORAGE.md)。実Amexの本人情報による適合確認・配布移行は#16。

## 操作

1. 拡張の設定タブでプロフィールと必須パスワードを登録する。
2. 対応ページでPopupを開くと、URLと現在のフォームを自動確認する。未登録なら設定へ、対象外なら入力ボタンを出さない。
3. ロック中なら解除する。保持チェックは既定ON。**解除だけでは入力しない。** IME変換中のsubmitは拒否する。
4. 「自動入力」を明示クリックする。既存値が違う場合は保持し、固定の項目名と理由で要確認を表示する。入力結果の詳細は折り畳みで表示する。
5. 「入力を停止」または「ロック」で以後の入力を停止する。既に許可されて同期実行中の操作は完了し得る。入力済みの値は巻き戻さない。本人が最終確認・申込送信・同意を行う。

保持OFFは入力開始時にセッション鍵を消費する。失敗・中断・一部入力でも次回は再解除が必要。ONでも再起動や拡張の再読込等で早期失効し得る。保持の説明をPopupへ表示し、再表示時にWorkerへ再照会する。

## 状態と秘密の境界

- Workerが処理を所有する。Popupはパスワードを解除要求時だけ渡し、送信開始/pagehideで欄を消去する。プロフィール・復号鍵を受け取らない。
- 同時実行は1件。operation ID、revision、epoch、tab ID、document IDを束縛。クリック直前にURLと3つの識別項目（email/firstName/legalBusinessName）のDOMを再確認し、36項目を個別検証する。
- `withProfile`は確定した文書へのISOLATED注入だけに平文を渡す。各項目と追加click直前のguardは同じ送信元tab/document/origin、operation ID、失効状態を確認する。設定からのlock/update/PW変更/resetでも停止する。別タブ選択・URL変更・文書再読込は失効として扱う。
- 非秘密の`autofillResultV1`だけを`storage.session`へ保存する。内容は固定field/status、phase、操作UUID、revision、tab/document ID。URL・入力値・例外・鍵を含めない。local/syncへ結果を保存しない。
- Popupを閉じてもWorkerの処理は続く。再表示は同じ文書の結果だけを示す。別文書へ前回結果を流用しない。手動lock等では以前の完了結果を無効化する。Popupは古い非同期応答を世代番号で破棄する。
- Worker再起動時、保存されたrunningをinterruptedへ変え、実行を再開しない。旧注入からのguardを拒否する。最終結果の保存まで実行所有権を保持し、後続実行を拒否する。最終保存失敗では「入力結果を保存できませんでした」と表示し、成功を断定しない。解除処理中の再表示はWorkerの状態を照会する。
- ページに渡した文字列、JS/ブラウザ内コピーや既入力DOMの完全消去は保証しない。ページのイベントによる通信があり得る。拡張は外部API・隠しAPIを呼ばない。

## 入力前・入力後の検査

ID/name/label/type、可視/無効/readonly、一意性、maxlength/minlength等を確認する。非同期待機・focus後にもDOMと現在値を再検査し、後から入力された値を上書きしない。選択欄とradioも不一致の既存選択は保持する。DBA、個人事業主、住所同一は実DOMの状態で分岐する。

住所候補は登録street/unit/city/state/ZIPを連結した表示と、大小文字・空白の差だけを除いて完全一致する場合のみ対象。一意で可視のDIV/LI role=optionに限定し、リンク・button・フォーム等を除外する。候補クリック直前にも候補と住所欄の値を検査する。番地の部分一致・異なる部屋番号・未知の略記/表示形式は「住所候補を確認」とし、推測で選択しない。

既存PR #8の全項目検出・条件分岐・select/radio・住所候補・入力後の再検証を移植した。Submit/Accept/同意/CAPTCHAは対象に含めず、デザイン開示は一意で可視の固定文言のtype=buttonだけ。UIは値を表示せず件数と固定理由を示す。実サイトのDOMが異なる項目を成功と見なさない。

## ビルドと合成検証

通常の `npm run build:extension` はAmex host権限を持ち、コードで確認済みorigin/pathに限定する。loopback権限とfixture判定を無効化する。旧7項目の平文Popupは通常UIから除去した。以前の保存キー・DMGは読取・変換・削除しない。

```sh
npm run check
PROBE_TEST_BROWSER=chromium npm run test:extension
npm run test:autofill
PROBE_TEST_BROWSER=chromium npm run test:settings
PROBE_TEST_BROWSER=chrome npm run test:extension
```

`test:extension`だけは`AUTOFILL_FIXTURE=1`でテスト用拡張を生成し、ブラウザ内で合成フォームを返す。localhostサーバー・実Amexへの通信は不要。出力は`dist/extension-fixture`で、通常版を上書きしない。合成版はloopback権限のみで実Amexの権限を持たない。実在人物の値やユーザープロファイルは使わず、trace/HARを作らない。

合成MV3検証は未登録/対象外/誤PW/IME/長文、解除のみでは未入力、明示入力、Popup再表示、二重実行拒否、既存値、一部失敗、停止、設定からのlock、保持OFF、文書遷移、Worker再起動、非秘密の結果保存を対象とする。DOM回帰は最後のguard/focusによる値・属性変更と、危険/類似/変更された住所候補の非クリックを対象とする。通常ChromeのテストではCDPで使い捨て拡張をロードし、ネイティブaction Popupの入力・途中閉鎖・結果再表示も検証する。CDPロードは一時的なので、ブラウザ再起動後の継続インストールの証拠にはしない。

## 本人による実Amex確認 (#16)

本人の明示承認後、通常ビルドを専用の確認環境に読み込む。対応URLを本人が開き、設定と暗号化保存、解除だけでは未入力、本人クリックによる入力、結果と実フォームの内容を手元で確認する。未知ラベル・選択肢・住所候補は手動確認し、未対応のまま記録する。記録は固定項目名と原因だけにし、PII・PW・URL query・HAR・スクリーンショットをGit/PR/CIへ出さない。申込送信・同意・CAPTCHAをテストの自動処理に含めない。旧データの移行・削除は別途本人判断とする。

2026-10-13の検証状況: 93 tests・lint/typecheck/format、Chromium MV3統合とDOM競合回帰が成功。独立レビューで非同期後のDOM再検査、住所候補、最終結果保存の競合を修正し、残るblocking findingsなし。通常Chromeのネイティブaction Popupでも手動ロック・解除（解除だけでは未入力）・明示入力・途中閉鎖後の処理継続・結果再表示が成功。ChromeのネイティブPopupにはsender.documentId/frameId/tabが付かないため、拡張ID・origin・完全一致のPopup URLを検証したうえで、この形のみ許可する。設定画面と申込文書のdocument束縛は維持する。
