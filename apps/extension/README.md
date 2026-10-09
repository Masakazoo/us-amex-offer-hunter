# Autofill MVP — Phase 2B

Chrome MV3 / Vanilla TypeScript。7項目の端末内profile、明示的な検出・Fill Now、編集・保存・全削除を実装。
**このビルドの入力先は `http://127.0.0.1:4173/autofill-fixture` だけ。実Amexの入力確認は未実施。**

## 試す

1. `npm ci` と `npm run build:extension` を実行。
2. `npm run fixture:autofill` でローカル模擬フォームを起動。
3. Braveの拡張管理画面（Chromeも可）でデベロッパーモードを有効にし、`dist/extension` を「パッケージ化されていない拡張」として読み込む。
4. 上記ローカルURLを開き、拡張のpopupを開く。
5. 意味を持たない文字列を入力し「端末に保存」。popupを開き直して保存内容を確認。
6. 「フォームを検出」で項目ごとの状態を確認し、Fill Nowで空欄に反映。
7. 「保存情報を全削除」で拡張内の保存値とpopupの入力欄を消す。対象ページの既存値は消さない。

対象はEmail Address、Legal Business Name、Business Name on Card、Company DBA Name、First Name、Last Name、Name on Card。
入力内容の編集は「端末に保存」で次回へ保存する。Fill Nowはpopupの現在値を使い、自動保存はしない。

## 保存と権限

ユーザーの「一回入力したら使い回せるようにする」という方針により `chrome.storage.local` にversion 1のstrict profileを保存する。
暗号化なしの端末内保存。sync、サーバー送信、console、研究Observationへの出力はしない。端末・ブラウザprofileへアクセスできる人からの秘匿は保証しない。
SSN、税ID、DOB、住所、電話、収入、自由な追加項目はprofileスキーマが拒否する。
保存へのアクセスはTRUSTED_CONTEXTSに制限。拡張権限はstorage/scriptingとloopback hostのみ。
ページへの注入関数に渡す値は実行中のメモリ上だけで扱い、戻り値には固定field IDとstatusしか含めない。

## 入力契約

- main frameの固定URLだけ。query/hash付きURLや他サイトを拒否。
- 現在のDOMのid/nameがそれぞれ一意で同じinputを指し、labelが確認済みの文字列と一致すること。
- input/textのみ。未知label、role付きcustom control、非表示、disabled（親fieldsetも含む）、readonly、inert、既存値はスキップ。
- 空値は入力しない。実測上限と現在のmaxlength/minlengthに従い、切り捨て・正規化はしない。未知pattern付きはスキップ。
- 検出したtab/document IDにFill Nowを限定。再読込・別tabへ変わったら再検出が必要。
- 入力直前にも各項目を検証。native setter + input/changeを使い、同期イベントでDOMが置換・変更された場合はchangedと表示する。
- click、focus、blur、submit、accept、navigationは実行しない。入力イベントを受けたページ自身の通信・動作を阻止する機能ではない。
- framework固有の非同期更新、全項目の原子的更新やrollbackは未対応。実Amexへの適合性は未確認。

## 検証

`npm run check`、`npm run test:extension`。CIは`PROBE_TEST_BROWSER=chromium`を指定。
実MV3のpopup→保存→再読込→検出→isolated world入力→結果表示→削除を検証する。
外部通信を拒否し、loopback模擬フォームと当該拡張のリソースだけを許可。値は意味を持たないsentinelのみ。
ブラウザprofileはテストの一時領域で破棄し、スクリーンショット・trace・HARを作らない。

参考: [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[Playwright extension testing](https://playwright.dev/docs/chrome-extensions)。

## 次の境界

実Amex対応は別途、本人の正しい情報・実際の申込意思を確認して進める。現在のmanifest/URL guardに実Amexの許可はない。
住所combobox、select、checkbox、税ID/SSN/DOB/収入は今回対象外。
Offer Labの高額オファー判定機能は未実装。用途分類・条件比較には別の観測契約が必要で、通信の時刻一致だけで判定を推測しない。
Playwrightのmain frame DOM自動取得問題は未解決。Chrome DevTools MCPでのDOM取得検証は未実施で、過去のComputer Use経由のDevTools確認とは区別する。実AmexでのAutofill検証を含め、PR #6マージ後の別スレッドへ引き継ぐ。

## 暗号化保管庫のYAMLをメモリへ読み込む

本人情報は既存の暗号化ディスクイメージ内の `profile.yaml` を正本にする。内容やパスワードをCodexへ渡さず、本人が拡張のファイル選択で読み込む。

1. `npm run build:extension` 後、ブラウザの拡張管理から `dist/extension` を読み込むか、既存の拡張を再読み込みする。
2. 本人が `tools/profile-vault/Unlock Profile.command` をTerminalで開き、暗号化パスワードを入力する。固定のローカル保管庫を読み取り専用でマウントし、Finderでファイルを示す。通常の編集ランチャーとは別で、内容を表示・変更しない。
3. 拡張の「解除済み保管庫の profile.yaml を選択」でファイルを選ぶ。7項目の形式検査に成功すると、値はマスク表示される。編集は保管庫の正本側で行う。
4. 起動したTerminalへ戻ってEnterを押し、保管庫を閉じる。拡張を開き直してもブラウザsession中は再利用できる。入力完了後のファイルをチャットやGitへ貼らない。
5. 利用後は「メモリの本人情報を削除」。他に開いている拡張画面にも削除を反映する。ブラウザ終了・拡張再読み込みでもsession情報は消える。再利用時はファイル選択だけで、本人情報の再入力は不要。

この版は実Amexへの入力権限を持たない。本人情報を模擬フォームへ送らないため、ファイル読込モードではFill Nowと「端末に保存」を無効化し、イベント処理側でも拒否する。既存の手入力ローカルテストモードは維持する。DBA空文字は「指定なし」として保持するが、実サイトのDBAなしcheckbox操作は未実装。

形式は7つの固定キーと二重引用符文字列だけの限定YAML。コメント・空行・BOM・CRLFは許可し、未知/重複/欠落キー、暗黙型、タグ、alias、入れ子は拒否する。二重引用符内のescapeはJSON互換のみ。8 KiB上限、各項目の既存文字数制約を検査し、正規化・切り捨てはしない。これは形式検査であり、emailの到達性や正式名・事業実態・申込資格を認証するものではない。

読込値は `chrome.storage.session` にのみ保持し、TRUSTED_CONTEXTSに限定する。local/sync、console、ファイル名、研究ログへ書かない。失敗時は固定メッセージだけを表示し、置換前のsession情報も破棄する。OS crash dump等やブラウザメモリ自体の完全なゼロ化は保証しない。以前手入力で保存したlocal情報は自動削除しないが、session情報があればそちらを優先する。「保存情報を全削除」はlocal/session双方を消し、暗号化ファイルは変更しない。

実Amexへの有効化、実入力後の照合は別途の準備・承認が必要。テストは合成sentinelのみを使用し、本人の保管庫は開かない。
