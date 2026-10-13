# Amex Autofill拡張

`npm run build:extension`で`dist/extension`を生成し、Chrome/Braveの拡張管理から読み込む。設定画面で36項目を暗号化して登録する。対応申込ページでPopupを開き、必要なら解除し、「自動入力」を本人がクリックする。解除だけでは入力しない。

通常ビルドの対象は確認済みのUS Amex Business Platinum申込host/pathのみ。個別のDOMが検証できなければその項目は入力しない。本人情報を用いた実Amexへの適合確認は#16で行う。申込送信・同意・CAPTCHA操作は含まない。

- [配布物監査・実機E2E・旧方式の保全と移行](../../docs/RELEASE-AND-MIGRATION.md)
- [設定画面・パスワード・初期化](../../docs/PROFILE-SETTINGS.md)
- [Popup・進捗・停止・結果・検証](../../docs/POPUP-AUTOFILL.md)
- [暗号化保管層と失効の限界](../../docs/ENCRYPTED-PROFILE-STORAGE.md)

合成テストは `PROBE_TEST_BROWSER=chromium npm run test:extension` と `npm run test:autofill`。前者が生成する`dist/extension-fixture`はloopbackだけを許可し、実Amexの権限は持たない。通常版`dist/extension`とは分離され、上書きしない。旧7項目の平文保存キーとDMGには触れず、自動移行はしない。
