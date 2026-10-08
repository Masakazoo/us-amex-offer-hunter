# Safety and privacy

## 保存禁止

SSN、ITIN、Federal Tax ID、生年月日、氏名、住所、電話、email、income、business revenue、Cookie、Authorization header、access/session/applicant request token、raw request body、raw response bodyは、ログ・Git・fixture・テストデータへ保存しない。架空PIIのfixtureも作らない。テストは意味を持たないsentinelで漏洩を確認する。

申込profileと研究Observationは分離する。Phase 2Bの7項目profileは、ユーザーの再利用要求に基づき拡張のstorage.localだけへ保存する。これは上記のログ・Git・fixture保存禁止の例外ではない。暗号化なし・同期なし、編集と全削除が可能。SSN/税ID/DOB/住所/電話/収入はprofile対象外。

## 操作の境界

- Submit Application / Accept Cardを実行しない。調査中は人間も押さない。
- CAPTCHAを操作しない。遭遇したら終了する。
- anti-fraud/bot回避、webdriver concealment、fingerprint spoofing、proxy rotation、credential/session取得、hidden API呼出しを実装しない。
- probeに汎用fill/click/press/submitコマンドを持たせない。2026-10-08の明示的な追加依頼により、Computer Useで公開商品ページのApplyと空欄focus・blur・scrollを行える。これは申込値入力やSubmit/Acceptの許可ではない。CAPTCHA・ログイン要求では終了する。
- ダミー値を本番へ送信しない。focus/DOM/selector調査を先に行う。focus/blurにも通信の可能性がある。
- 無通信が一度観測されたことは安全の証明ではない。遅延送信・navigation時送信もあり得るため、このMVPで実サイトへのダミー入力を解禁しない。
- input/change/blur区間に通信があるfieldは、因果関係未確定でも `requires-real-user-data`。それ以上のダミー操作は禁止。
- 実データ検証は本人の明示判断、正当な申込意図と管理下でのみ実施し、記録には値を含めない。今回の作業では実施しない。

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

unit testsは実データを使わない。browser smokeはPlaywright routing内の合成ページのみ。外部requestはabortし、実AmexページへのCIアクセスを禁止する。CI成果物にブラウザのraw artifactをアップロードしない。
