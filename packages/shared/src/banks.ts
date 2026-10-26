import type { BankAccount, Settings } from './settings.js';
import { t } from './i18n.js';

export interface BankInfo {
  code: string;
  name: string;
  nameEn: string;
  color: string;
  /** e-wallet providers receive PromptPay via a 15-digit e-wallet ID */
  wallet?: boolean;
}

/** Banks and wallets in Thailand. PromptPay / Thai QR works with all of their apps. */
export const BANKS: BankInfo[] = [
  { code: 'KBANK', get name() { return t('ธนาคารกสิกรไทย'); }, nameEn: 'Kasikornbank', color: '#138f2d' },
  { code: 'SCB', get name() { return t('ธนาคารไทยพาณิชย์'); }, nameEn: 'Siam Commercial Bank', color: '#4e2e7f' },
  { code: 'BBL', get name() { return t('ธนาคารกรุงเทพ'); }, nameEn: 'Bangkok Bank', color: '#1e4598' },
  { code: 'KTB', get name() { return t('ธนาคารกรุงไทย'); }, nameEn: 'Krungthai Bank', color: '#1ba5e1' },
  { code: 'BAY', get name() { return t('ธนาคารกรุงศรีอยุธยา'); }, nameEn: 'Bank of Ayudhya (Krungsri)', color: '#fec43b' },
  { code: 'TTB', get name() { return t('ธนาคารทหารไทยธนชาต'); }, nameEn: 'TMBThanachart Bank', color: '#0050f0' },
  { code: 'GSB', get name() { return t('ธนาคารออมสิน'); }, nameEn: 'Government Savings Bank', color: '#eb198d' },
  { code: 'BAAC', get name() { return t('ธ.ก.ส.'); }, nameEn: 'BAAC', color: '#4b9b1d' },
  { code: 'GHB', get name() { return t('ธนาคารอาคารสงเคราะห์'); }, nameEn: 'Government Housing Bank', color: '#f57d23' },
  { code: 'CIMBT', get name() { return t('ธนาคารซีไอเอ็มบี ไทย'); }, nameEn: 'CIMB Thai', color: '#7e2f36' },
  { code: 'UOB', get name() { return t('ธนาคารยูโอบี'); }, nameEn: 'UOB Thailand', color: '#0b3979' },
  { code: 'KKP', get name() { return t('ธนาคารเกียรตินาคินภัทร'); }, nameEn: 'Kiatnakin Phatra Bank', color: '#635f98' },
  { code: 'TISCO', get name() { return t('ธนาคารทิสโก้'); }, nameEn: 'TISCO Bank', color: '#12549f' },
  { code: 'LHB', get name() { return t('ธนาคารแลนด์ แอนด์ เฮ้าส์'); }, nameEn: 'LH Bank', color: '#6d6e71' },
  { code: 'ICBCT', get name() { return t('ธนาคารไอซีบีซี (ไทย)'); }, nameEn: 'ICBC (Thai)', color: '#c50f1c' },
  { code: 'TCRB', get name() { return t('ธนาคารไทยเครดิต'); }, nameEn: 'Thai Credit Bank', color: '#0a4ea2' },
  { code: 'IBANK', get name() { return t('ธนาคารอิสลามแห่งประเทศไทย'); }, nameEn: 'Islamic Bank of Thailand', color: '#184615' },
  { code: 'TMW', get name() { return t('ทรูมันนี่ วอลเล็ท'); }, nameEn: 'TrueMoney Wallet', color: '#f39200', wallet: true },
  { code: 'OTHER', get name() { return t('ธนาคารต่างประเทศ / อื่นๆ'); }, nameEn: 'Foreign / other bank', color: '#5f6368' },
];

export const bankInfo = (code: string): BankInfo => BANKS.find((b) => b.code === code) ?? BANKS[BANKS.length - 1]!;

/** Account used for PromptPay QR: the chosen one, else the default, else any with PromptPay, else the legacy store field. */
export function promptPayAccount(settings: Settings, accountId?: string | null): { promptPayId: string; account: BankAccount | null } | null {
  const withPP = settings.payments.accounts.filter((a) => a.promptPayId);
  const acc = (accountId && withPP.find((a) => a.id === accountId)) || withPP.find((a) => a.isDefault) || withPP[0];
  if (acc) return { promptPayId: acc.promptPayId, account: acc };
  if (settings.store.promptPayId) return { promptPayId: settings.store.promptPayId, account: null };
  return null;
}

export function maskAccount(n: string): string {
  const d = n.replace(/\D/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 4)}-${d.slice(4, 9)}-${d.slice(9)}`;
  return n;
}
