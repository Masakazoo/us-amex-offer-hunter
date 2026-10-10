# 暗号化・セッション設計 Spike (#10)

2026-10-10。対象は合成データ専用PoCと設計。#11の本実装、設定/Popup UI、実Amex入力、旧保管庫の読取・削除は行わない。[UX正本](AUTOFILL-UX-SPEC.md)を維持する。

## 1. 結論と採用条件

推奨は **Web Crypto / AES-256-GCM / PBKDF2-HMAC-SHA-256 600,000回**。永続先は `chrome.storage.local` の暗号文レコード1個。解除中だけ `chrome.storage.session` に32-byte復号素材をbase64で置き、操作ごとに非抽出可能なCryptoKeyへimportする。パスワード・平文プロフィールをsessionへ保存しない。

Braveの実MV3でWorker停止を越える保持とブラウザプロセス再起動時の消失を確認した。通常版Google ChromeでのGUI終了、背景実行、実Popup、パッケージ更新は未確認であり、全DoD達成とはしない。#11の設計レビューは可能だが、正式着手には未確認項目の確認と設計承認が必要。PoCコードをそのまま本番へ移植しない。

## 2. 暗号方式・KDF比較

| 候補                               | 安全性・時間/メモリ                                                             | MV3・依存・CSP・保守                                                                               | 判断                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| PBKDF2 SHA-256 600,000回 + AES-GCM | GPU総当たりへの耐性はメモリハード方式より弱い。小さい作業メモリ。実測時間は後述 | Web Crypto標準、暗号ライブラリ不要、既定のself-only script CSPで動作                               | 個人利用での単純さと保守性から推奨。弱いPWを補うものではない           |
| Argon2id                           | メモリハード。OWASP最低例19 MiB/t=2/p=1。RFC 9106の制約環境例64 MiB/t=3/p=4     | Web Crypto標準外。監査済みWASMの同梱、更新管理、`wasm-unsafe-eval`の許可、実ブラウザ性能検証が必要 | 暗号学的には優先候補だが今回は追加実装せず。速度・ピークメモリは未測定 |
| scrypt                             | メモリハード。OWASP例N=2^17/r=8/p=1（約128 MiB）                                | Web Crypto標準外。ライブラリ/テスト/更新負担                                                       | Argon2idを採れない場合の候補。今回は不採用                             |
| SHA-256単発 / HKDF単独             | パスワード探索を遅くしない                                                      | 簡単でもパスワードKDFの代替にならない                                                              | 却下                                                                   |

[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)はArgon2idを第一推奨とし、PBKDF2 SHA-256には600,000回を示す。これはパスワード保管の指針をKDF強度の参考にしたもので、本製品のFIPS認証や暗号化保管庫の安全保証ではない。[RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)参照。暗号化API・認証タグ・鍵importは[Web Crypto仕様](https://www.w3.org/TR/webcrypto/#aes-gcm)、WASM制約は[Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)参照。

600,000回はv1の固定値（自動で引き下げない）。将来は遅い対象端末での実測も含め見直す。長く一意なパスフレーズを勧める。PoCは空文字拒否のみであり、本番の作成時強度チェック・確認入力は#11/#12で定義する。文字列をtrim/normalizeして意図せず変換しない。

## 3. 保存schema・乱数・認証

PoCの正本は `tools/security-spike/crypto.ts` のstrict schema。概形:

```typescript
{
  version: 1, payloadVersion: 1, revision: UUID,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: base64_16bytes },
  cipher: { name: 'AES-GCM', iv: base64_12bytes, tagLength: 128 },
  ciphertext: base64_ciphertext_with_tag
}
```

- `getRandomValues`でsalt 128bit、IV 96bitを生成。**書込ごとに新salt→新鍵、新IV**。失敗後の再試行も作り直す。確率的衝突の可能性はゼロではないが、カウンタ復元・巻き戻りによる再利用を避ける。壊れた乱数源への耐性は保証しない。
- 全メタデータを固定順配列にしてUTF-8 JSON化しGCMのAADへ含める。タグは128bit。metadataの変更も認証失敗にする。
- base64長さ、形式、対応version/algorithm/iteration、ciphertext上限を復号前に検査。未知versionは読取拒否して保持。攻撃者指定の巨大KDF反復数を実行しない。
- 誤PWと正しく構造化された暗号文の改ざんは同じ `AUTH_OR_CORRUPT`。両者を暗号だけで確実に区別できない。別のPW照合ハッシュは保存しない。
- 有効な古いレコード全体の差替え（rollback）はAEADで検出できない。外部の信頼できる単調カウンタを持たない本設計の残余リスク。
- #11のpayloadはPR #8のstrict profile schemaで検証し、payloadVersionも管理する。PoCのpayloadは固定の架空markerのみ。

## 4. 鍵・平文・パスワードの寿命

| 情報                    | 置き場所・寿命                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| パスワード              | UI入力→認証要求→WorkerでKDF。入力欄を消し、完了後参照を破棄。session/local/logに保存しない |
| KDF用UTF-8 bytes        | `finally`でzero-fill。CryptoKeyの内部コピーはGC依存                                        |
| 32-byte復号素材         | 解除成功後だけsessionにbase64で保持。解除revisionとkeep flagに関連付ける                   |
| 非抽出可能AES CryptoKey | 操作中のWorkerメモリだけ。終了後参照を破棄                                                 |
| 平文プロフィール        | 明示操作時だけ復号。検証/限定的注入/編集に必要な範囲。復号byte配列はzero-fill              |
| 暗号文                  | local。セッション鍵と同一領域に置かない                                                    |

JavaScriptのstring、GC、structured serialization、Web Crypto内部コピーの確実なゼロ化は保証できない。session素材も実質的な復号鍵であり、base64は保護ではない。OS swap、hibernation、crash dump、管理者・DevToolsによるメモリ取得まで「ディスクに一切残らない」と保証しない。禁止するのはアプリによる秘密の永続Storage保存。

平文丸ごとのsession保持は不要なPIIコピーと漏えい箇所を増やすため採らない。必要時復号なら鍵素材だけ保持し、プロフィールは短命にできる。ただしsession鍵を盗まれれば暗号文を復号できるため、端末侵害への保護強度が大幅に上がるという意味ではない。

## 5. セッションと操作の所有者

[Chrome Storage仕様](https://developer.chrome.com/docs/extensions/reference/api/storage)によるとsessionは拡張ロード中のメモリで、ブラウザ再起動・拡張無効化/再読込/更新で消失する。JSON serializationであり、CryptoKeyのstructured clone対応と混同しない。PoCでは非抽出可能鍵を書き戻すと `{}` 相当になり使用不能だった。

`storage.local`と`storage.session`は初期化時に `setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})`。sessionをcontent scriptへ公開しない。localも既定のcontent scriptアクセスを制限する。本番では全読書きをWorker一箇所へ集約し、初期化完了前は要求を処理しない。

| 案                                     | 結論                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| 非抽出可能鍵をsessionへ直接保存        | JSONでは復元できないため却下                                                         |
| 非抽出可能鍵をWorkerのglobalだけに保持 | Worker停止時に再認証が必要。単純だが保持要件に不足                                   |
| IndexedDBにCryptoKeyを永続保存         | 永続復号能力を置くので要件違反                                                       |
| offscreen documentで鍵を生かす         | document寿命/理由/権限の追加。セッション維持のための常時生存に依存する設計は採らない |
| sessionに短命の復号素材                | 推奨。Worker再起動を越え、ブラウザ再起動を越えない                                   |

[Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)に従いglobal消失を前提にする。`onStartup`/`onSuspend`だけに鍵消去を依存させない。Workerのトップレベルでsessionをclearすると保持要件を壊すので行わない。

- `unlock(keep=true)`では認証とsession保存のみ。Autofillを発火しない。
- `use`は明示操作に対応する別要求。対象documentの検査後に、Workerが復号・必要な値だけ渡す。PoCは値を一切返さず「使用できた」だけ返す。
- OFF時は一回の使用開始でsession素材を取り除き、実行中のローカル参照だけで完了まで動かす。完了後に残らず、Worker死亡や二重クリックによる再利用も防ぐ。UIはrunningを別表示し、途中失敗も再認証。実DOM注入の中断復旧は#13。
- 手動ロックはsessionを削除。成功応答後に新たな使用を拒否。すでにサイトへ渡した値を取り消すものではない。
- 全要求をsingle Writerのキューで直列化。変更/使用はexpected revisionを照合し、古いUIを拒否。並行changeは1件だけ成功。session revisionがlocalと一致しなければ解除とみなさない。
- #11/#13ではさらにsession epoch・operation ID・tabId/documentIdを結び付け、同一revisionでもlock後の古い要求が再unlock後に使われないようにする。ロック受付時にepochを進め、長い処理の結果を注入前に再確認。PoCは短い直列操作のみで、長時間注入/ロック割込を証明しない。
- incognitoは別コンテキスト競合を増やすため本番では無効を推奨。Chromeプロファイルをまたぐ保持はしない。

「Chrome終了」はブラウザプロセスの終了を意味する。ウィンドウを全部閉じてもmacOSや背景実行でChromeが残る場合があり、ロック保証に読み替えない。曖昧な場合は手動ロックを使う。OS画面ロック・sleep連動は今回の要件外。

## 6. 変更・削除・失敗・マイグレーション

**変更:** 有効sessionで復号→session無効化→新salt/IVで新PWに再暗号化→完成したレコードを1回の `local.set` で置換。成功してもロック状態。旧PWは新レコードに通らない。再登録/通常編集も新revisionで旧sessionを無効化する。PoCは合成payloadが固定であり、編集APIは作らない。

**削除:** 認証不要（忘れた場合にも必要）、ただし本番UIで不可逆確認→session削除→所有するlocal key削除。領域全体の `clear()` でOffer Lab等を巻き込まない。壊れたschemaでもロック/削除可能にする。バックアップ、OS snapshot、過去の暗号文の安全消去は保証しない。

**失敗/中断:** 暗号化完成前は旧レコードに触れない。PoCはcommit直前の障害注入で旧レコードの完全一致と旧PWでの復号を確認。Storage内部の途中書込/電源断/媒体障害まで原子性を実証したものではない。Chrome Storageに一般的なトランザクション/CAS保証を仮定しない。

#11ではwrite前のexpected revision、1レコード単位のset、read-back照合で成功応答を制御する。set/検証が失敗したときは `COMMIT_UNKNOWN` を許し、読戻して旧/新/破損を判別する。無条件のrollback、空データでの上書き、成功トーストは禁止。変更中断後は旧または新PWの再入力で現存レコードを検査し、破損なら自動初期化しない。PW変更後も旧暗号文のバックアップは旧PWで開くため、その失効は保証しない。

session削除失敗ならロック成功と表示せず、そのWorkerでは新規復号を止める。本番はretry/拡張再読込による安全側復旧を用意する。PoCにはsession API故障時の永続的な拒否ラッチは未実装。

**マイグレーション:** envelope versionとpayload versionを独立管理。未知versionは保持し非対応エラー。既知旧versionは解除後、メモリ内でvalidation/migration、新salt/IV/現行KDFへ再暗号化してから同じcommit手順。旧暗号文を残す一時退避を導入するなら、旧PWでも読める期間と削除完了を明示し、復旧テストを追加する。今回はmigration engineを作らない。

## 7. 脅威モデル

| 脅威                              | 対策・対象                                                                 | 残余リスク                                                                         |
| --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Chrome保存領域の取得              | 対象。認証付き暗号文、鍵分離、salt付きKDF                                  | オフライン総当たり、旧snapshotのrollback、弱いPW                                   |
| 解除済み端末の第三者操作          | 一部対象。手動ロック、再起動時失効、明示入力                               | 操作権限を得た人は復号/入力できる。OSアカウント保護が必要                          |
| 他拡張                            | 拡張固有storage、external messagingなし、権限最小                          | 同じ申込ページのDOMを読める拡張は入力後のPIIを取得し得る                           |
| 悪意あるWebページ/XSS             | 対象。URL/DOM/document検証、ISOLATED注入、CSP                              | 正規サイト自体のXSSは入力された値を読める。拡張のXSSは解除鍵に到達し得る           |
| 不正メッセージ/content script漏洩 | 対象。sender ID/厳密な拡張page URL、strict command schema、trusted storage | 同一拡張の侵害は境界内。鍵/プロフィールを汎用messageで返さない                     |
| OS侵害/マルウェア/DevTools        | 保護対象外                                                                 | keylogger、session/メモリ取得、画面取得。暗号化だけで防げない                      |
| ログ/診断情報                     | 対象。固定エラー/件数のみ。生例外、profile、URL、鍵、PWを出さない          | 手動DevTools、OS dump、スクリーンショットは別管理                                  |
| パスワード総当たり                | 対象。600k KDF、長い一意PW、オンライン試行抑制                             | rate limitは取得済暗号文へのオフライン攻撃を防げない。PBKDF2はメモリハードではない |
| 配布物/依存の改変                 | 対象。ローカル同梱、外部コードなし、レビュー/固定lockfile                  | 拡張アップデート自体が悪意ある場合は秘密に到達可能                                 |

PoC拡張にはhost permissions、content scripts、externally_connectable、外部fetchがない。CSPは `script-src 'self'; object-src 'none'; connect-src 'none'`。本番のAmex入力はサイト自身の通信を起こし得るため「通信ゼロ」としない。

## 8. 旧DMG移行とPR #8資産

**案A（推奨）:** 本人が既存DMGを見て新設定画面へ再登録。追加の読取ツール/権限/平文一時ファイル不要。入力負担と転記ミスが残るため保存後の本人照合が必要。

**案B:** 一回限りread-onlyインポート→strict validation→ブラウザ内再暗号化。転記は減るがNative/ファイル境界、平文転送、プロセスと失敗時清掃の設計・監査が増える。必要性と明示承認がある場合だけ別Issueで検討。

どちらも移行完了を本人が確認するまでDMGと旧ブランチを残す。今回、実データ・個人保管庫にはアクセスしていない。

棚卸しの正本は[Issue #10](https://github.com/Masakazoo/us-amex-offer-hunter/issues/10)、固定commit `3150ba6b51836ac037e73737cc122cad992c81af`。追加で以下のコード/テストを参照したが本PRへ移植していない。

| 資産                                                                           | 後続での再利用                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/extension/src/full-profile.ts` / `profile.ts`                            | #11/#12。36項目定義、strict schema、形式/条件付きvalidation。DBA・個人事業主・住所同一。保存方式から独立移植                                                     |
| `full-autofill.ts` / `target.ts`                                               | #13。origin/path/top-frame/expected URL、一意性、label/name/type、可視/無効、既存値、入力後確認。`source: vault-file`を認証済操作契約へ置換するがguardは除かない |
| select/checkbox/radio、住所street+ZIP、再描画処理                              | #13。曖昧候補は `address-review`。再描画/非同期変更で再取得。Submit/Accept/同意/CAPTCHA禁止を維持                                                                |
| `tests/full-profile.test.ts` / `profile.test.ts` / `extension-target.test.ts`  | #11/#12/#13。条件必須、未知選択肢/余分キー拒否、legacy7項目で残りを捏造しない                                                                                    |
| `tests/full-form-fixture.ts` / `full-autofill-smoke.ts` / `extension-smoke.ts` | #13/#16。既存値、重複選択肢、name不一致、非同期変更、validation、住所曖昧、送信0。UI selectorのみ新契約へ                                                        |
| Native/DMG/Terminal/YAML経路                                                   | 新通常フローに採用しない。旧枝は保持。#16で本人の移行確認後に整理                                                                                                |

36項目の実Amex動作やISOLATED適合を証明したものではない。既存7項目の受動観測と合成E2Eを区別する。

## 9. PoC実行・結果

```sh
npm ci
npm run check
npm run test:security                          # Brave / 新規一時profile
SECURITY_BROWSER=chromium npm run test:security # Playwright Chromium / CI
SECURITY_HEADED=1 npm run test:security         # headed Brave
```

`tools/security-spike/build.ts`が `dist/security-spike` を生成。合成の固定payloadのみ。既存の本番拡張とは別ID/別一時browser profileで、既存プロファイルや実保管庫を開かない。終了時にこのテスト用profileだけ削除。Node unit testとMV3のbrowser testは別物。

実行記録（2026-10-10、macOS、Node 24.11.1）:

- `npm run check`: lint/typecheck、47 unit tests、format成功。
- Brave HeadlessChrome 148 / Playwright Chromium HeadlessChrome 153: 下表の自動assertion成功。各実行に再読込の **UNKNOWN 1件** があり、完全合格ではない。
- 600,000回KDFを含むunlock往復5回: Brave `[40,40,39,39,39]` ms、Chromium `[48,47,47,47,47]` ms。単一端末での参考値。KDF単体のベンチマークではない。ピークメモリ・低速端末・Argon2id比較実測はUnknown。
- 拡張再読込後は5秒間の再試行でも `ERR_BLOCKED_BY_CLIENT`。拡張が再ロードされなかった原因とsession消去そのものは未確定。ブラウザ再起動の結果で代用しない。
- PoCの終了コード0は実行できたassertionの成功を表す。UNKNOWNも必ず読む。`SECURITY_REQUIRE_RELOAD=1 npm run test:security` は未確認再読込を非0終了にする。CIのgreenは#10全DoD達成を意味しない。

### 検証範囲

| ケース                                                | 結果・証拠の限界                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| AES-GCM roundtrip、誤PW、暗号文/AAD改ざん、schema拒否 | Node Web Crypto unit + 実MV3（AAD/schemaはunit）                                                        |
| local暗号文のみ、sync空、CryptoKey serialization      | 実MV3 Storageで確認                                                                                     |
| Popup閉鎖・再表示                                     | harness拡張documentをtabで破棄/再生成して保持確認。実toolbar PopupはUnknown                             |
| 別タブ/遷移                                           | harness→about:blank→harnessで保持確認                                                                   |
| Worker停止/再起動                                     | CDP stopAllWorkers、新boot ID、sessionによる復号成功。自然idle停止はUnknown                             |
| ブラウザ再起動                                        | 同じ一時disk profileを正常close→再launch、暗号文存続・解除消失。通常Chrome GUI quit/backgroundはUnknown |
| OFF・手動ロック                                       | 競合use 2件で1件だけ成功、以後LOCKED。実Autofill完了/中断は後続                                         |
| PW変更                                                | 旧PW拒否、新PW成功、旧revision拒否、旧session失効                                                       |
| 保存失敗                                              | commit前の注入失敗で旧レコード完全一致/旧PW成功。Storage quota/途中I/O/電源断はUnknown                  |
| 全削除                                                | 暗号文/session削除。旧DMG等は対象外                                                                     |
| 拡張再読込                                            | Unknown（再読込後ページがブロック）。パッケージ更新もUnknown                                            |
| 複数Window                                            | 独立windowから同revisionの並行変更は1件成功。長時間注入中の割込はUnknown                                |

通常版Google Chromeの自動化は `--load-extension` でWorkerが出現せず、DevTools `Extensions.loadUnpacked` も `Method not available`。この環境では自動検証経路が成立しなかった。Chromeで成功したと読み替えない。補足: [Playwrightの拡張テスト制約](https://playwright.dev/docs/chrome-extensions)。

### #10を完了するための手動確認

隔離した新規Chrome profileに `dist/security-spike` をunpackedでロードし、DevToolsで合成コマンドだけを送る。通常profileを使わない。検証後はこの合成profileだけ整理する。

1. harnessで `chrome.runtime.sendMessage({op:'create', password:'SYNTHETIC test password'})`、次にunlock。statusはbool/revisionだけで、storage全体をログに出さない。
2. 実toolbar Popupを開閉し、再表示のstatusを確認。開くだけではuseしない。
3. DevToolsを閉じてidle停止を待ち、再表示時のboot ID変化と保持を確認。
4. Chromeをウィンドウ閉鎖/メニュー終了でそれぞれ操作。背景実行設定ON/OFFを記録し、プロセス終了時のみ再認証となるか確認。
5. 拡張再読込/無効→有効/バージョン変更で解除が消えることを確認。
6. 低速端末で5回以上の解除時間とメモリを測る。失敗/unknownを成功欄へ移さない。

## 10. #11への具体的引き継ぎ

API候補（実装しない）:

```typescript
createProfile(profile, password): Promise<Revision>
unlock(password, keep = true): Promise<SessionStatus>
getStatus(): Promise<SessionStatus> // 値や素材を返さない
lock(): Promise<void>
withProfile(operationToken, callback): Promise<SafeResult>
updateProfile(expectedRevision, profile): Promise<Revision>
changePassword(expectedRevision, newPassword): Promise<Revision>
resetProfile(confirmed): Promise<void>
```

Web Cryptoの `getRandomValues/importKey/deriveBits/encrypt/decrypt`、Chrome `storage.local/session`、Worker `runtime.onMessage` を使う。profile/envelope/sessionのschemaを別に置き、UIやcontent scriptに鍵APIを公開しない。`withProfile`はWorker内部契約で、任意callbackをmessageとして受けない。editのためにプロフィールを返す場合は正規設定pageのみに限定する。

エラー分類: `NOT_REGISTERED`, `LOCKED`, `AUTH_OR_CORRUPT`, `INVALID_INPUT`, `UNSUPPORTED_VERSION`, `CONFLICT`, `UNAUTHORIZED`, `STORAGE_READ`, `STORAGE_WRITE`, `COMMIT_UNKNOWN`, `CANCELLED`。生のZod error/exceptionはPIIを含み得るので固定コードに変換。PoCの `INVALID_OR_STORAGE` は簡略版で本番分類の代替ではない。

#11テスト: schema/bounds/乱数長、AAD全項目、誤PW/改ざん、create/update/change/reset、古いrevision/epoch、one-shot race、lock中断、session故障、set前/後/読戻し失敗、未知version、破損時reset、平文・鍵の永続化/ログ不在、実Chrome lifecycle。KDF低強度へのテスト専用分岐を本番に混ぜない。

順序は **#10確認・承認→#11暗号層→#12日本語+US英語設定→#13 Popup/明示入力→#16実機E2Eと本人移行確認**。#12はマスク/強度/初期化確認、#13は操作所有・epoch・document束縛・非秘密結果の保持、#16は通常Chrome/実Popup/実サイトと移行後整理を担当する。旧コードの一括マージはしない。
