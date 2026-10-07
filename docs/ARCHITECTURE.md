# Architecture

## 全体とデータフロー

```mermaid
flowchart LR
  Human[人間のブラウザ操作] --> Browser[Brave / Chrome]
  Browser --> Events[Playwright events / DOM observer]
  Events --> Core[core allow-list projection]
  Core --> Schema[strict runtime schema]
  Schema --> Reports[local ignored reports]
  Reports --> Research[人間による安全な知見の整理]
  Research --> Future[将来のMV3 Autofill / Offer Lab]
```

単一npmプロジェクト。monorepo管理ツールやビルドframeworkは導入しない。

## application-probe

- CLI: 初期URLの安全なhostチェック、headed browser起動、inspect/idle/finish、出力権限と終了処理。
- `browser-script`: documentごとのtrusted focus/input/change/blurの観測。フォームの値を取得しない。操作するAPIは提供しない。
- `Recorder`: contextレベルのrequest/response/finished/failedイベント、frame/document内の一時IDを実行内field aliasへ変換する。
- `report`: 保存直前のstrict schema検証、stepごとのMarkdown。自由なエラー文字列を保存しない。

操作は `performance.timeOrigin + performance.now()`、通信はPlaywright Request.timingのstartTimeを使う。終了時に開始時刻を補正し、export時に時刻順で再対応付けする。これによりbinding配送の遅延やレスポンスの遅延に依存しない。開始時刻が得られない通信は受信時刻を使うため精度が下がる。

statusは受信時、duration/responseMsは取得できた場合のみ設定する。未完了はpending、失敗はfailed、redirectは別requestとredirectedFrom sequence。HTTP 4xx/5xxも通信自体が完了すればfinished。

### 観測の限界

- stepは直前の観測操作との時間的関連。背景通信、debounce、並行frame、navigationの後処理を因果的に分離できない。
- initiator stackは取得しない（script URLや引数に秘密があり得る）。`initiator: not-collected` と `attribution: temporal-only` を必ず保持。
- 実probeはsite本来の挙動をなるべく保つためservice workersをallowした新規context（Observation: allowed）。offline browser smokeはblock（Observation: blocked）。通常の既存sessionや通常ウィンドウと同条件ではない。incognitoの判定も行わない。
- HTTP request lifecycleが対象。Service Worker allowは完全取得を意味しない。一部SW挙動の可視性は未検証。WebSocket frame、WebRTC、browser内部通信は記録しない。閉じる瞬間の非同期イベントは取りこぼす可能性がある。
- native input/select/textareaを対象とする。custom combobox、closed shadow DOM、クロスプロセスframe等の完全性は未検証。DOM inspectionはdocument querySelectorベースでshadow treeを走査しない。
- DOM検査中に破棄されたframeはスキップする。次のinspectで再試行する。
- raw DOM属性の候補は一時的にメモリでのみ識別に使う。exact allow-list以外はログへ残らないため、selectorの採否は実機で別途確認が必要。
- ブラウザのフォーム送信を技術的に完全遮断するものではない。人間も調査中はSubmit/Acceptしない。

Playwright公式: [Request lifecycle/timing](https://playwright.dev/docs/api/class-request)、[Service workers](https://playwright.dev/docs/service-workers)。

## core

- `amex/fields`: ユーザー指定の候補ラベル語彙。name/id/autocomplete/aria-label/label/placeholderを比較し、競合はambiguous。Amex固有selectorの確認済みデータではない。
- `amex/url`: HTTPS exact hostで単一applicationCode queryを優先し、queryがない場合だけpathname末尾を構文解析。重複・不正queryは拒否する。ユーザー観測のBusiness Platinum URL例をサポートするが、書式がAmex公式仕様とは主張しない。
- `redaction`: 任意objectを保存する汎用redactではなく、既知のプロパティだけから新規objectを構築。unknown host/pathのaliasは実行間比較には使えない。将来、実機確認済みの固定routeだけをcode reviewで許可する。
- `schemas`: nested strict schema。PIIや自由文結果、raw URL、未定義フィールドを拒否。schemaエラーもraw出力しない。

## Chrome Extension（将来）

MV3、Vanilla TypeScript。`popup` がFill Nowの明示実行、`options` が本人用profileのローカル管理、`autofill` が現在DOMだけを検出・入力、`offer-lab` がPIIを含まない観測を担当する。現時点でmanifestや入力コードはない。

profileはObservationと別経路にし、同期・送信・ログ出力を禁止する。SSN等の保持方法は実装前にユーザーと決める。入力候補が一意でない、既存値がある、対象が非表示などの場合の挙動も次Phaseで確定する。submit/accept/navigationの実行権限をAutofillに与えない。

## 将来拡張の順序

実機DOM/Network観測 → 固定route・属性の安全なレビュー → selectorとvalidation契約 → Fill Now MVP → 条件注釈・Offer Lab比較UI。body解析が必要になっても、まず構造のみをメモリで検査し、安全性を明示判断したendpoint/field単位のadapterを追加する。未知bodyを再帰保存する機能は作らない。
