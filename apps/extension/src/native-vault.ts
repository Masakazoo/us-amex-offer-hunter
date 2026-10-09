import { z } from 'zod';
import { fullProfileSchema } from './full-profile.js';

export const nativeHostName = 'com.us_amex_offer_hunter.profile_vault';
export const nativeStateKey = 'nativeVaultStateV1';
export const nativeErrorCodes = [
  'cancelled',
  'vault-busy',
  'vault-missing',
  'not-encrypted',
  'unlock-failed',
  'invalid-profile',
  'close-failed',
  'unavailable',
] as const;
export type NativeErrorCode = (typeof nativeErrorCodes)[number];
export const nativeResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), values: fullProfileSchema }).strict(),
  z
    .object({ status: z.literal('error'), code: z.enum(nativeErrorCodes) })
    .strict(),
]);
export type NativeResponse = z.infer<typeof nativeResponseSchema>;
export const nativeStateSchema = z
  .object({
    status: z.enum(['loading', 'loaded', ...nativeErrorCodes]),
  })
  .strict();
export type NativeState = z.infer<typeof nativeStateSchema>;
export const nativeStatusText: Record<NativeState['status'], string> = {
  loading: '保管庫のパスワードを入力してください。読み込み後、自動で閉じます。',
  loaded:
    '申込情報を読み込み、保管庫を閉じました。フォームを検出してください。',
  cancelled:
    '読み込みをキャンセルしました。「保管庫から読み込む」で再開できます。',
  'vault-busy':
    '保管庫が別の画面で開いています。先に閉じてから再試行してください。',
  'vault-missing': '保管庫が見つかりません。初回登録を確認してください。',
  'not-encrypted': '保管庫の暗号化を確認できないため、読み込みを中止しました。',
  'unlock-failed':
    '解除できませんでした。パスワードを確認して再試行してください。',
  'invalid-profile':
    '登録情報を読み込めませんでした。登録画面で保存し直してください。',
  'close-failed':
    '保管庫を閉じられなかったため、情報を読み込みませんでした。Finderで保管庫を取り出してください。',
  unavailable:
    '保管庫との接続に失敗しました。補助プログラムのインストールを確認して再試行してください。',
};
