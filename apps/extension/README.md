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
Offer Labの用途分類・条件比較には別の観測契約が必要で、通信の時刻一致だけで高額offerの判定を推測しない。
