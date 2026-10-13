import {
  fullFieldSpecs,
  fullProfileSchema,
  profileIssues,
  type FullProfile,
  type FullFieldSpec,
} from '../full-profile.js';

export type Section = 'business' | 'personal' | 'design' | 'security';
export const sections: {
  id: Section;
  title: string;
  english: string;
  description: string;
}[] = [
  {
    id: 'business',
    title: '事業情報',
    english: 'Business information',
    description: '申込に使用する事業の情報を入力してください。',
  },
  {
    id: 'personal',
    title: '個人情報',
    english: 'Personal information',
    description:
      'ご本人の情報を入力してください。機密性の高い項目はマスクして表示します。',
  },
  {
    id: 'design',
    title: 'カード設定',
    english: 'Card preferences',
    description:
      'いずれも任意です。実際の申込画面で選べる内容をご確認ください。',
  },
  {
    id: 'security',
    title: 'セキュリティ',
    english: 'Security',
    description: 'パスワードと登録データを管理します。',
  },
];
export const unverifiedLabels = new Set([
  'cardDesign',
  'cardMaterial',
  'businessCity',
  'businessState',
  'city',
  'state',
]);
export const sensitiveFields = new Set(['ssn', 'federalTaxId', 'dateOfBirth']);
// English strings are the stored values. Japanese strings are help text only.
const optionHelp: Record<string, string> = {
  AL: 'アラバマ',
  AK: 'アラスカ',
  AS: '米領サモア',
  AZ: 'アリゾナ',
  AR: 'アーカンソー',
  CA: 'カリフォルニア',
  CO: 'コロラド',
  CT: 'コネチカット',
  DC: 'コロンビア特別区',
  DE: 'デラウェア',
  FL: 'フロリダ',
  GA: 'ジョージア',
  GU: 'グアム',
  HI: 'ハワイ',
  ID: 'アイダホ',
  IL: 'イリノイ',
  IN: 'インディアナ',
  IA: 'アイオワ',
  KS: 'カンザス',
  KY: 'ケンタッキー',
  LA: 'ルイジアナ',
  ME: 'メイン',
  MH: 'マーシャル諸島',
  MD: 'メリーランド',
  MA: 'マサチューセッツ',
  MI: 'ミシガン',
  FM: 'ミクロネシア連邦',
  MN: 'ミネソタ',
  MS: 'ミシシッピ',
  MO: 'ミズーリ',
  MT: 'モンタナ',
  NE: 'ネブラスカ',
  NV: 'ネバダ',
  NH: 'ニューハンプシャー',
  NJ: 'ニュージャージー',
  NM: 'ニューメキシコ',
  NY: 'ニューヨーク',
  NC: 'ノースカロライナ',
  ND: 'ノースダコタ',
  MP: '北マリアナ諸島',
  OH: 'オハイオ',
  OK: 'オクラホマ',
  OR: 'オレゴン',
  PW: 'パラオ',
  PA: 'ペンシルベニア',
  PR: 'プエルトリコ',
  RI: 'ロードアイランド',
  SC: 'サウスカロライナ',
  SD: 'サウスダコタ',
  TN: 'テネシー',
  TX: 'テキサス',
  UT: 'ユタ',
  VT: 'バーモント',
  VA: 'バージニア',
  VI: '米領バージン諸島',
  WA: 'ワシントン',
  WV: 'ウェストバージニア',
  WI: 'ウィスコンシン',
  WY: 'ワイオミング',
  AE: '米軍郵便（AE地域）',
  AP: '米軍郵便（AP地域）',
  AA: '米軍郵便（AA地域）',
  Corporation: '法人',
  Partnership: 'パートナーシップ',
  'Sole Proprietorship': '個人事業主',
  Agriculture: '農業',
  Construction: '建設業',
  'Finance/Real Estate': '金融・不動産',
  'Government Entity': '政府機関',
  'Insurance Services': '保険サービス',
  Manufacturing: '製造業',
  'Non-profit': '非営利団体',
  'Retail Trade': '小売業',
  'Wholesale Trade': '卸売業',
  Other: 'その他',
  'Less than one year': '1年未満',
  '1-2 years': '1〜2年',
  '3-5 years': '3〜5年',
  '6-10 years': '6〜10年',
  '11-15 years': '11〜15年',
  '16-20 years': '16〜20年',
  'More than 20 years': '20年超',
  'General Manager': '総責任者',
  Owner: '所有者',
  Partner: 'パートナー',
  'President/Chairman': '社長・会長',
  Treasurer: '財務責任者',
  VP: '副社長',
  'Other Authorizing Officer': 'その他の権限を持つ役員',
  Classic: 'クラシック',
  Mirror: 'ミラー',
  Metal: '金属',
  '85% Recycled Plastic': '再生プラスチック85%',
};
export function optionLabel(value: string): string {
  return optionHelp[value] ? `${value} — ${optionHelp[value]}` : value;
}
export function inactive(key: string, profile: FullProfile): boolean {
  return (
    (key === 'companyDBAName' && profile.doingBusinessAs === 'yes') ||
    (key === 'federalTaxId' &&
      profile.companyStructure === 'Sole Proprietorship') ||
    (['addressLine1', 'addressLine2', 'zipCode', 'city', 'state'].includes(
      key,
    ) &&
      profile.sameAddress === 'yes')
  );
}
export function hint(spec: FullFieldSpec): string {
  if (spec.kind === 'checkbox') return '';
  if (spec.format === 'zip') return '半角数字5桁';
  if (spec.format === 'phone')
    return '米国の電話番号10桁（ハイフン・空白・括弧も可）';
  if (spec.format === 'tax' || spec.format === 'ssn')
    return '半角数字9桁（ハイフンも可）';
  if (spec.format === 'date') return 'MM-DD-YYYY（月2桁・日2桁・西暦4桁）';
  if (spec.format === 'money')
    return 'USD・半角数字、小数は2桁まで（カンマなし）';
  if (spec.format === 'digits') return '半角数字・3桁以内';
  if (spec.key === 'email') return '例: name@example.com';
  if (spec.key === 'businessState' || spec.key === 'state')
    return '州・準州などの英語略号';
  if (spec.options) return '英語の選択肢に日本語の補助説明を併記しています。';
  return `${spec.max}文字以内`;
}
export type FieldIssue = {
  field: string;
  reason: 'required' | 'format' | 'inconsistent';
};
export function validateProfile(profile: FullProfile): FieldIssue[] {
  const structural = fullProfileSchema.safeParse(profile);
  const issues: FieldIssue[] = structural.success
    ? profileIssues(structural.data)
    : structural.error.issues.map((issue) => ({
        field: String(issue.path[0]),
        reason: 'format',
      }));
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))
    issues.push({ field: 'email', reason: 'format' });
  return issues.filter(
    (item, index) => issues.findIndex((i) => i.field === item.field) === index,
  );
}
export const labels = new Map(
  fullFieldSpecs.map((spec) => [spec.key, spec.title]),
);
