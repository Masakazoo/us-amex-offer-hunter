# Extension boundary — planned

Phase 1ではChrome拡張は未実装。manifestやAmex固有selectorは置かない。
将来はManifest V3 / Vanilla TypeScriptで構成する。

- popup: ユーザーのFill Nowと検出項目の確認
- options: 本人のローカルprofile設定。研究Observationから分離
- autofill: 現在DOMの意味的検出と入力。submit/accept/navigation権限なし
- offer-lab: 安全な条件・結果のみのObservation

実装開始条件は [RESEARCH](../../docs/RESEARCH.md) を参照。
