/** PromptPay QR payload per EMVCo MPM / Bank of Thailand Thai QR Payment spec. */

function tlv(tag: string, value: string): string {
  return tag + value.length.toString().padStart(2, '0') + value;
}

export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type PromptPayTarget =
  | { kind: 'phone'; value: string }
  | { kind: 'taxId'; value: string }
  | { kind: 'ewallet'; value: string };

export function normalizePromptPayId(raw: string): PromptPayTarget {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 15) return { kind: 'ewallet', value: digits };
  if (digits.length === 13) return { kind: 'taxId', value: digits };
  if (digits.length === 11 && digits.startsWith('66')) {
    return { kind: 'phone', value: '00' + digits };
  }
  if (digits.length >= 9 && digits.length <= 10) {
    const local = digits.replace(/^0/, '');
    return { kind: 'phone', value: ('0066' + local).padStart(13, '0') };
  }
  throw new Error('PromptPay ID must be a phone number (10 digits), tax/citizen ID (13) or e-wallet (15)');
}

/** @param amount satang; omit/0 for a static QR where the payer enters the amount. */
export function promptPayPayload(id: string, amount?: number): string {
  const target = normalizePromptPayId(id);
  const subTag = target.kind === 'phone' ? '01' : target.kind === 'taxId' ? '02' : '03';
  const merchant = tlv('00', 'A000000677010111') + tlv(subTag, target.value);
  const dynamic = !!amount && amount > 0;
  let payload =
    tlv('00', '01') +
    tlv('01', dynamic ? '12' : '11') +
    tlv('29', merchant) +
    tlv('53', '764') +
    (dynamic ? tlv('54', (amount / 100).toFixed(2)) : '') +
    tlv('58', 'TH');
  payload += '6304';
  return payload + crc16ccitt(payload);
}

export function isValidThaiTaxId(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
}
