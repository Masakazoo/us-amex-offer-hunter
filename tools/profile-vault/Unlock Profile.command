#!/bin/zsh -f
# User-run only: never invoke with real passwords through agent tools.
unsetopt XTRACE
set -eu
set -o pipefail
umask 077
base="$HOME/Library/Application Support/us-amex-offer-hunter"
image="$base/ProfileVault.dmg"
mount="$base/Unlocked"
mounted=0
cleanup() {
  unset vault_pass 2>/dev/null || true
  if (( mounted )); then
    if /usr/bin/hdiutil detach "$mount" -quiet; then
      print '保管庫を閉じました。拡張のメモリ内データは「メモリの本人情報を削除」で消せます。'
    else
      print '取り出せませんでした。ファイル選択画面等を閉じ、FinderでAmexProfileVaultを取り出してください。'
    fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
[[ -f "$image" ]] || { print '暗号化ファイルが見つかりません。作成済みの保存先を確認してください。'; exit 1; }
encrypted=$(/usr/bin/hdiutil isencrypted -plist "$image" | /usr/bin/plutil -extract encrypted raw -o - -)
[[ "$encrypted" == true ]] || { print '暗号化を確認できないため中止します。'; exit 1; }
mkdir -p "$mount"
if /sbin/mount | /usr/bin/grep -Fq " on $mount ("; then
  print '保存領域はすでに開いています。先に閉じてから再実行してください。'
  exit 1
fi
print '本人情報を再入力する必要はありません。保管庫を読み取り専用で開きます。'
read -rs 'vault_pass?暗号化パスワード（文字は表示されません）: '
print
printf '%s\0' "$vault_pass" | /usr/bin/hdiutil attach "$image" -stdinpass -readonly -mountpoint "$mount" -nobrowse -quiet
mounted=1
unset vault_pass
[[ -f "$mount/profile.yaml" ]] || { print 'profile.yamlが見つかりません。'; exit 1; }
/usr/bin/open -R "$mount/profile.yaml"
print '拡張の「ファイルを選択」で以下を選択してください。'
print -r -- "$mount/profile.yaml"
print '読み込み成功後、この画面へ戻ってEnterを押すと保管庫を閉じます。'
read -r '?読み込みが終わったらEnter: '
