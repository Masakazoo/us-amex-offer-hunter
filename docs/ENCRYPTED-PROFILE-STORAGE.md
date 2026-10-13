# 暗号化プロフィール保管層 (#11)

2026-10-13。承認済みの[#10設計](SECURITY-ARCHITECTURE.md)に基づく保管層。設定画面は#12、実Autofillは#13、本人の旧DMG移行と配布更新の検証は#16。本PRは合成データだけで検証し、旧データの読取・移行・削除を行わない。

## 保存と暗号

- `apps/extension/src/vault/crypto.ts`: AES-256-GCM、PBKDF2-HMAC-SHA-256 600,000回、16-byte salt、12-byte IV、128-bit tag。メタデータ全体をAADへ含める。新規/PW変更でsalt更新、すべての暗号化でIV/revision更新。通常編集は既存鍵とsaltを使用し、直前IVとの一致を拒否。
- 作成/変更パスワードは**12 Unicode code points以上**、最大1024 UTF-16 code units。長く一意なパスフレーズを推奨。文字種の強制・trim・Unicode正規化なし。不正な単独surrogateはUTF-8変換時の衝突を避けるため拒否。解除は既存暗号文の互換性のため非空を検査する。
- 元PR #8の固定commit `3150ba6b51836ac037e73737cc122cad992c81af` から36項目の定義/条件validationを移植。構造が正しい未入力・形式未完成の途中プロフィールも暗号化保存する。申込形式の検査はWorkerの自動入力前に行い、未完成の値はページへ渡さない。旧7項目から欠損値を捏造しない。選択肢は保存schemaの契約であり、現在の実Amex画面との一致を保証しない。
- localの `encryptedProfileV1` は暗号文と公開envelope。`encryptedProfileEpochV1` は非秘密の失効UUID。sessionの `encryptedProfileSessionV1` は32-byte canonical base64復号素材、revision/epoch、keep、使用済operation ID（上限128）。`encryptedProfileAttemptV1` は次の解除試行時刻のみ。
- パスワード・平文・復号鍵はlocal/sync/ログに出さない。session素材は実質的な復号鍵。Uint8Arrayはfinallyでzero-fillするが、JS文字列/GC/Web Crypto内部コピー/OS swapの完全消去は保証しない。暗号文のoffline総当たり・過去snapshotのrollbackも残余リスク。
- local/sessionをTRUSTED_CONTEXTSへ制限した後に処理。初期化失敗は拒否。sync、外部通信、Native Messaging、追加host permissionなし。incognitoは無効。

## 呼出契約

`ProfileVault` はWorkerの単一インスタンスから使う。各要求を直列化し、手動lock/resetの受付は同期barrierを進め、先行するKDFやconsumerを取り消す。

| API                                          | 条件と結果                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(profile,password)`                   | 未登録のみ。作成後ロック。未知/破損レコードを上書きしない                                                                                          |
| `status()`                                   | 値・鍵を返さず登録/解除/revision/epoch/keepのみ。未知version/破損は固定エラー                                                                      |
| `unlock(password,keep=true)`                 | 認証後sessionへ保存。入力は起こさない。Worker再起動を越える1秒の試行間隔あり                                                                       |
| `lock()`                                     | epoch更新＋session削除と読戻し。両方確認できた場合のみ成功                                                                                         |
| `update(revision,epoch,profile)`             | 有効sessionと旧暗号文を確認後に再暗号化。成功後ロック                                                                                              |
| `changePassword(revision,epoch,newPassword)` | 有効sessionで復号し新salt/鍵/IVへ変更。成功後ロック                                                                                                |
| `reset(true)`                                | PW不要、明示確認必須。未知/破損でも実行可能。暗号文とsessionを削除し、非秘密の失効UUIDは残す。他機能/legacy keyは変更しない                        |
| `withProfile(token,verifyDocument,consume)`  | Worker内部のみ。revision/epoch/operation ID/tabId/documentIdを要求。消費開始前にoperation IDを記録し、OFFなら先にsessionを失効。同IDの再利用を拒否 |

`withProfile`の呼出側はtokenのtabId/documentIdを実際の対象に照合する`verifyDocument`を提供し、`consume`内でも**値を対象へ渡す直前に`assertCurrent()`をawait**する。対象検証と注入の統合は#13。コールバックや任意コードはmessageから受けない。保持ONでも同sessionで128回使用後は再解除が必要。

production Workerのmessageはchannel `profile-vault-v1`とstrict commandのみ。sender ID/origin/document ID/top-frame/incognitoを検査し、query/hashを含まない完全一致の拡張URLだけ許可する。popup.htmlはstatus/unlock/lockのみ、将来のsettings.htmlは登録/更新/PW変更/resetも可能。鍵を返すmessageは存在しない。#12では`readForEditing(revision,epoch)`を追加し、正規の設定タブからの要求だけへプロフィールを返す。popup/content scriptには返さない。読込後も設定タブ側で再照会してから表示する。[設定画面の契約](PROFILE-SETTINGS.md)を参照。

#12の設定タブと#13の通常Popupが保管層に接続する。Popupはプロフィールを受け取らず、Worker内部consumerから検証した対象文書へ渡す。[Popupの契約](POPUP-AUTOFILL.md)を参照。保管層専用テストconsumerは`dist/vault-test`だけに含まれる。

## 障害・競合・復旧

- 書込前に現存暗号文とexpected値を照合。完成した暗号文を1回のsetで置換し、読戻しをcanonicalなキー順で比較する。Chrome Storageのトランザクション/CASを仮定しない。
- 書込前の失敗は旧暗号文を維持。書込開始後の例外、読戻し不一致/失敗、保存中のlock/reset受付は`COMMIT_UNKNOWN`。旧/新どちらが残ったかを勝手に断定せず、無条件rollbackや再保存をしない。statusで再照会し、旧/新PWで現存データを検査する。UIで「取消＝保存されていない」と表示しない。
- lock前のepochで発行された要求は再解除後も拒否。すでにサイトへ渡った値を手動ロックで取り消すことはできない。
- session削除だけの失敗ではlocal epochが残った鍵を失効させ、Worker再起動後も利用不可。epoch更新だけの失敗ではsession削除により利用不可。どちらも`STORAGE_WRITE`で返し、そのWorkerはブロックする。正常なlock再試行で復旧可能。
- **epoch更新とsession削除が同時に失敗した場合は、どちらにも失効情報を残せない。** 当該Workerでは拒否するが、Worker停止/再起動を越えた失効は保証できない。ロック成功を表示せず、**拡張の再読込（session消失）を復旧条件**とする。Worker再起動だけを復旧操作にしない。#12/#13のエラー導線にこの条件を反映する。
- OFFでは開始時にsessionを取り除く。失敗・中断・二重クリック後の再試行には解除が必要。保持ONはdocument再作成/Worker停止を越えて保持し得るが、ブラウザ終了・拡張再読込/無効化/更新で消える。全window閉鎖だけでは終了を保証しない。詳細は[Chrome実測とUI注意](CHROME-VALIDATION.md)。
- 誤PW/認証タグ不一致は共通`AUTH_OR_CORRUPT`。未知versionは`UNSUPPORTED_VERSION`で保持。生のZod errorや例外、プロフィール、PW、鍵を応答/ログへ出さない。

## 検証

```sh
npm run check
npm run test:vault                         # 一時profileのPlaywright Chromium
VAULT_BROWSER=brave npm run test:vault     # 同じ合成検証をBraveで実行
VAULT_BROWSER=chrome npm run test:vault    # 通常Chrome、初回だけUIでdist/vault-testを読み込む
```

Chromeでは起動後120秒以内に拡張管理画面で「デベロッパーモード」→「パッケージ化されていない拡張機能を読み込む」→`dist/vault-test`。既存profileは使用しない。再起動後は再インストールせず同じprofileに残った拡張で検証する。最後にテストprofileを削除する。

2026-10-13の実行結果:

- `npm run check`: 71 unit tests、lint/typecheck/format成功。暗号/AAD/誤PW/schema、create/update/change/reset、stale revision/epoch、one-shot/replay、lock中断、session前後障害、local set前後/読戻し障害、二重Storage障害の保証限界を検証。
- `npm run test:vault`: Playwright Chromiumの実MV3で成功。KDF＋解除47ms（単一端末の参考値、最低性能保証なし）。document再作成・Worker強制停止後の保持、同profileブラウザ再起動後の暗号文存続/解除消失、合成consumerの復号、保持OFF、手動lock、PW変更、resetの他key保持、sender役割制限を確認。
- 設定/Popupと合成フォームの統合検証は#12/#13を参照。実Amexの本人情報による注入は未検証。#10の通常Chromeでの再読込/無効化/再起動/自然idle実測は[別のPoC証拠](CHROME-VALIDATION.md)として区別する。配布更新、実プロフィール、電源断、全OS/背景設定、DMG移行は#16。
- CIに`test:vault`を追加。試験は固定の合成marker/無効なゼロ識別子のみ。生成物やブラウザprofile、秘密値をCI artifactへ保存しない。
