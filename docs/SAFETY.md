# Safety and privacy

## 保存禁止

SSN、ITIN、Federal Tax ID、生年月日、氏名、住所、電話、email、income、business revenue、Cookie、Authorization header、access/session/applicant request token、raw request body、raw response bodyは、ログ・Git・fixture・テストデータへ保存しない。架空PIIのfixtureも作らない。テストは意味を持たないsentinelで漏洩を確認する。

申込profileと研究Observationは分離する。実Amexに使う全申込項目は暗号化保管庫を正本とし、読み込んだ値をTRUSTED_CONTEXTSのstorage.sessionだけで保持する。以前のPhase 2B手入力モードのstorage.localはローカルテスト専用で、実サイトには渡さない。これは上記のログ・Git・fixture保存禁止の例外ではない。SSN/税ID/DOB/住所/電話/収入を含む本人情報は、本人が暗号化保管庫の登録画面で入力し、拡張のsessionメモリだけへ読み込む。

## 操作の境界

- Submit Application / Accept Cardを実行しない。調査中は人間も押さない。
- CAPTCHAを操作しない。遭遇したら終了する。
- anti-fraud/bot回避、webdriver concealment、fingerprint spoofing、proxy rotation、credential/session取得、hidden API呼出しを実装しない。
- probeに汎用fill/click/press/submitコマンドを持たせない。2026-10-08の明示的な追加依頼により、Computer Useで公開商品ページのApplyと空欄focus・blur・scrollを行える。これは申込値入力やSubmit/Acceptの許可ではない。CAPTCHA・ログイン要求では終了する。
- ダミー値を本番へ送信しない。focus/DOM/selector調査を先に行う。focus/blurにも通信の可能性がある。
- 無通信が一度観測されたことは安全の証明ではない。遅延送信・navigation時送信もあり得るため、このMVPで実サイトへのダミー入力を解禁しない。
- input/change/blur区間に通信があるfieldは、因果関係未確定でも `requires-real-user-data`。それ以上のダミー操作は禁止。
- 実データ検証は本人の明示判断、正当な申込意図と管理下でのみ実施し、記録には値を含めない。2026-10-09に実申込ページ対応の依頼を受けた。実情報は本人が保管庫から読み込み、最終送信は本人が行う。

## Allow-list保存境界

1. Networkからmethod、時刻、status、resource type、内部sequence、数値timingだけを投影。headers/body/error本文は取得しない。
2. URLは固定の `www.americanexpress.com` 以外のhostと、root以外のpathを実行内alias化。query/hash/credentials/portは出力しない。低エントロピーPIIを復元できるhash化は使わない。
3. probeのDOM観測では値を取得しない。属性は候補語彙と完全一致した文字列か、存在フラグのみ。任意のlabel/placeholder/pattern/validationMessage/selectorは保存しない。
4. schemaは全階層strict。未知キーを拒否。自由文のstep名、eligibility結果、環境名なども拒否。
5. レポート生成でも同じschemaを検証する。例外にはPIIが含まれ得るのでCLIは固定文のみ出力する。

application code parserは明示query、またはqueryがない場合のpathname末尾を既知書式で解析する独立utility。書式は観測例であり公式仕様とは断定しない。現行URL意味は未確認のためCLIによる自動採用はしていない。offer ID / campaign ID / treatment ID / request tracking IDは認証・個人追跡との関係が未確認で、保存しない。特にapplicant request tracking IDは名前だけで「非機微」と判断しない。

body調査が将来必要なら、まず値を持ち出さずメモリ上で構造を確認する。endpointとフィールドの意味・保存可否を明示レビューしてから専用adapterを追加する。汎用body exporterは実装しない。

## ローカルデータとGit

`runs/`、observations、HAR、screenshots、traces、browser/user profiles、`.env*` はGit対象外。保存は新規UUIDディレクトリ0700、ファイル0600。削除が必要な実行ディレクトリはユーザーが選んで削除する。共有前にはalias化済みのログでもレビューする。

実probeはPlaywrightの新規contextのみを使用する。拡張のローカルテストだけはMV3ロードに必要な一時persistent contextを使い終了時に破棄する。既存の個人profile、Cookie、`.env`、過去のrunsは読み込まない。HAR/trace/video/スクリーンショット収集機能はない。ブラウザ自体の一時profile管理・OS crash dumpなどはアプリ外の制約であり、ゼロ永続化を保証するものではない。DEBUG/Playwright debugログを実データ調査で有効にしない。

このprobeは第三者ページを隔離するセキュリティsandboxではない。ページ自体がPIIを送信する動作をブロックする仕組みではなく、ユーザーは実データの入力・申込を慎重に管理する。

## テスト

unit testsは実データを使わない。probeのbrowser smokeはPlaywright routing内の合成ページのみ。拡張テストはloopback模擬フォームと当該拡張のリソースを許可し、公式originの試験用document要求はroute.fulfillで合成HTMLを返す。公式originへ実際の通信は行わない。外部requestはabortし、実AmexページへのCIアクセスを禁止する。CI成果物にブラウザのraw artifactをアップロードしない。

## 暗号化YAMLの読込境界

本人が選択した全申込項目の限定YAMLは拡張内で検証し、TRUSTED_CONTEXTSのstorage.sessionだけで保持する。内容・ファイル名・parserエラーをログに出さない。読込モードでlocalへの保存と模擬フォームへの入力を拒否する。元の暗号化ファイルを唯一の正本とする。v0.5.0は本人の全項目入力・選択対応依頼に基づき、固定Business Platinum申込pathに限定して入力できる。実ページにはsessionのvault-file profileだけを渡し、手入力テスト値を拒否。自動テストに実データを使わない。詳細は拡張README参照。

## 全項目登録画面

登録ランチャーは暗号化を確認したDMGだけを編集用にマウントする。本人が入力し、エージェントは値・パスワードを読まない。localhost登録サーバーはランダムcapability、Host/Origin検査、外部通信を禁止するCSP、no-store、symlink拒否・同時変更検出・同一暗号化ディレクトリ内の0600一時ファイルによる保存を使う。独立したサーバーAPIはテスト用一時ディレクトリも扱うため、実運用の暗号化確認はランチャーが責任を持つ。

## Native Messaging読込

v0.6.0はファイル選択を省く依頼に対応する。Chromeへのローカル接続設定の追加は、登録対象・権限を示して承認を得る。インストーラーは非機微のコードと接続設定だけを扱い、保管庫を開かない。manifestとhelperの双方が単一の拡張IDを検証し、workerは自身のpopupと実Amexの固定対象だけから解除を開始する。

helperは固定の保管庫だけを暗号化確認・読み取り専用解除し、既知schemaを通した値を取り出し成功後に返す。パスワードは本人がmacOSダイアログへ入力し、argv・環境変数・ファイル・ログ・拡張へ渡さない。例外・子プロセスstderrは表示せず固定codeにする。本人情報は既存のTRUSTED_CONTEXTS/session境界を継続し、Submit/Acceptは実装しない。テストは使い捨て合成DMGと専用native hostだけを使う。強制終了・OS障害時にmount/lockが残る可能性はあるため、常に自動取り出しできるとは保証しない。
