# Issue #10 — 通常Chrome追加検証

2026-10-13、macOS、通常Google Chrome **155.0.8059.39**、Node 24.11.1。合成データ専用拡張を隔離した新規profileへ読み込んだ。Chromeログイン・実プロフィール・DMG・実Amex入力は対象外。基本設計は同日ユーザー承認済み。マージ・#11本実装は未承認。

## 確認結果

| ケース                    | 操作・観測                                                                                                                                   | 判定                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 拡張再読込                | 解除後、`chrome://extensions`の再読み込み。登録は残る、解除false、useはLOCKED、新Worker                                                      | 確認済み（UI操作＋合成API）                                  |
| 無効化→再有効化           | UIの有効スイッチOFFでharness閉鎖・Worker target消失、ONで登録true・解除false・useはLOCKED                                                    | 確認済み                                                     |
| Chromeメニュー終了→再起動 | 解除後メニューから終了、起動プロセスの正常終了を確認。同じdisk profileを再起動し、拡張の再インストールなしで登録true・解除false・useはLOCKED | 確認済み                                                     |
| 実toolbar Popup           | `action.openPopup`で作成し、`getViews({type:'popup'})`とnative AXで実Popupと確認。Escapeで閉鎖、再表示して解除true。閉鎖後popup view 0を確認 | 確認済み。製品PopupのE2Eではない                             |
| Worker強制停止            | CDP stopAllWorkers後にboot変更、解除true、合成use成功                                                                                        | 確認済み                                                     |
| Worker自然idle            | DevTools/CDP接続なしで通常Chromeを再起動。解除後30秒超、通信・操作せず待ち、状態更新でboot変更・解除true                                     | 確認済み。正確な停止時刻や全Chrome版の保証ではない           |
| 全window閉鎖              | 解除trueを確認して全windowを閉鎖。page target 0でもbrowser CDPは応答。その後の新windowでは新Worker・登録true・解除false                      | この環境では早期失効。profile/拡張アンロード等の原因は未確定 |
| 背景実行設定ON/OFF・他OS  | プロセスが動き続ける場合の全組合せは試していない                                                                                             | 未確認。UIは解除が続き得ることを案内する                     |
| 配布パッケージ更新        | 通常Chromeの実配布更新経路は未試験。公式仕様では更新時session消失                                                                            | #16の配布QAへ                                                |

上の「解除false」では再解除に合成パスワードが必要であり、暗号文は保持された。実Popupの表示だけでuseを実行するコードはない。自然idle検証はstatus pollingを行わず、最後の状態更新だけでWorkerの世代差を確認した。

## 再現できる自動試験

```sh
# 通常Chrome（最初の読込だけUI操作が必要、120秒待機）
SECURITY_BROWSER=chrome SECURITY_REQUIRE_RELOAD=1 npm run test:security
```

開いたテスト専用Chromeで「デベロッパーモード」→「パッケージ化されていない拡張機能を読み込む」→このrepoの `dist/security-spike` を選ぶ。以後は自動で合成試験・再起動・再読込を行い、一時profileだけ削除する。既存の通常profileを選ぶ引数は用意していない。実保管庫や本番拡張を選択しない。

今回、この経路は終了コード0、UNKNOWNなし。暗号文のみ保存、sync空、誤PW、CryptoKey JSON制約、document開閉・遷移、Worker強制停止、OFF競合、手動ロック、PW変更・複数window競合、commit前失敗、再起動、改ざん、削除・破損schema初期化、再読込のassertionが成功した。unlock往復5回は43/41/42/40/41 ms（単一端末の参考値）。

Chromeの `--load-extension` と一時的なCDP読込はこの経路に使わない。過去の `Extensions.loadUnpacked` エラーはpage-targetへの送信が原因だった。browser-targetでは読込できたが、再起動後に拡張が残らなかったため、再起動の証拠として採用していない。UI読込後は再起動時に再インストールしていない。

Brave/Chromiumの無人CI経路は従来通り。コマンドライン読込後の再読込がUNKNOWNの場合は、その結果を通常ChromeのUI読込経路と混同しない。

## 手動で再現する手順

事前にrepoで `node --import tsx tools/security-spike/build.ts` を実行。Chromeでログインしない新規テストprofileを作り、上記の方法で `dist/security-spike` を読み込む。Chromeの拡張メニューから **Synthetic security spike — never enter personal data** を開く。実際の個人情報やパスワードは入力できない。

1. **合成データを作成** → **合成パスワードで解除**。`registered=true unlocked=true` を確認。
2. Popupを閉じて再表示。`unlocked=true`。**ロック**を押してから再表示するとfalse。
3. もう一度解除して、拡張管理画面で再読込。再表示すると登録true・解除false。同様に解除→OFF→ONでも解除false。
4. 解除してChromeメニューの**終了**を実行。同じテストprofileで起動し直すと登録true・解除false。
5. 自然idleはDevToolsを閉じ、Popupにあるbootを控えてPopupを閉じ、45秒以上待って再表示。bootが変わり解除trueならWorker再起動を越えた保持を確認できる。boot不変なら自然停止した証拠にはしない。
6. 保持チェックOFFで解除し、**合成データを1回使用**。直後に解除false。実フォームには何も入力しない。
7. 背景動作を追加確認する場合はOS・Chrome版・背景実行設定を記録し、解除後すべてのwindowを閉じて再表示。trueでもfalseでも観測通り記録する。確実な失効には**ロック**を使用する。

記録は上のboolean、bootが変わったか、固定エラーコードだけでよい。Storage全体、鍵、実データ、スクリーンショットは不要。終了後はこのテストprofileだけを整理する。

## 独立レビューと後続の境界

別エージェントが暗号化・鍵管理・session寿命・保存失敗を独立レビュー。初回と追加差分の再レビューとも「合成専用PoCのmerge blockerなし」。暗号unit 2件を別途実行し、最終差分では `npm run check`（lint/typecheck/47 tests/format）と `git diff --check` も独立実行して成功。Chrome実機操作は本担当の実行結果を根拠としてレビューし、レビュー担当による重複実機試験は行っていない。本番へ直接転用しない条件で、次を後続の必須事項とする。

| Issue | 残す実装・試験                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #11   | session削除失敗後の利用拒否・復旧、32-byte canonical base64のsession schema、単一Writer/revision/epoch/operation ID、保存後read-back・COMMIT_UNKNOWN、実Storage API拒否/読戻し失敗のfault injection |
| #12   | 設定UIのマスク、編集中平文の寿命、全項目の日英ラベル、PW変更・初期化の確認                                                                                                                          |
| #13   | 製品Popupと実Autofill統合、長時間処理中のロック/キャンセル、document束縛、結果保持。合成フォームで送信・同意・CAPTCHA操作0を確認                                                                    |
| #16   | 配布更新・対象OS/Chrome版の背景動作、実プロフィール/DMG移行・本人による実Amex最終確認。電源断/媒体障害は保証限界を明記し、必要な復旧検証は使い捨て環境で別計画                                      |

PoCのcommit前障害注入はStorageの途中I/O・電源断に対する原子性を証明しない。暗号文・バックアップの安全消去、侵害済みOSからの保護、JS文字列の完全ゼロ化も保証しない。製品のセキュリティ受入条件を削らず、#10の技術成立性検証から分離する。
