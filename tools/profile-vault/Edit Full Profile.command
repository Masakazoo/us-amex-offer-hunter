#!/bin/zsh -f
# User-run only. Never run this against the user's vault through agent tools.
unsetopt XTRACE
set -eu
set -o pipefail
umask 077
base="$HOME/Library/Application Support/us-amex-offer-hunter"
image="$base/ProfileVault.dmg"
vault_mount="$base/Editing"
# Install substitutes the repository path in this non-secret launcher.
repo="__REPOSITORY__"
node_bin="__NODE__"
mounted=0
cleanup() {
  unset vault_pass 2>/dev/null || true
  if (( mounted )); then
    if /usr/bin/hdiutil detach "$vault_mount" -quiet; then
      print '保管庫を閉じました。'
    else
      print '取り出せませんでした。開いているファイル選択画面を閉じ、Finderで保管庫を取り出してください。'
    fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
[[ -f "$image" ]] || { print '保管庫が見つかりません。'; exit 1; }
encrypted=$(/usr/bin/hdiutil isencrypted -plist "$image" | /usr/bin/plutil -extract encrypted raw -o - -)
[[ "$encrypted" == true ]] || { print '暗号化を確認できないため中止します。'; exit 1; }
if /sbin/mount | /usr/bin/grep -Eq " on $base/(Unlocked|Editing) \\("; then
  print '保管庫はすでに開いています。前のTerminalでEnterを押して閉じてから、もう一度開いてください。'
  read -r '?Enterで終了: '
  exit 1
fi
mkdir -p "$vault_mount"
read -rs 'vault_pass?保管庫のパスワード（文字は表示されません）: '
print
printf '%s\0' "$vault_pass" | /usr/bin/hdiutil attach "$image" -stdinpass -mountpoint "$vault_mount" -nobrowse -quiet
mounted=1
unset vault_pass
cd "$repo"
"$node_bin" --import tsx tools/profile-editor/server.ts "$vault_mount"
print '拡張機能で、Finderに表示されたprofile.yamlを読み込んでください。'
read -r '?読み込みが終わったらEnter（保管庫を閉じます）: '
