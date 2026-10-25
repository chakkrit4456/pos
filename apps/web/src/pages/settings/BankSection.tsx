import { useState } from 'react';
import { toast } from 'sonner';
import { Building2, Pencil, Plus, QrCode, Star, Trash2 } from 'lucide-react';
import { BANKS, bankInfo, maskAccount, normalizePromptPayId, promptPayPayload, type BankAccount, t } from '@flexpos/shared';
import { cn, uuid } from '@/lib/utils';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { QrImage } from '@/components/PrintDocView';
import { SaveBar, SectionTitle, useDraft } from './common';

function ppError(id: string): string | null {
  if (!id) return null;
  try {
    normalizePromptPayId(id);
    return null;
  } catch {
    return t('ใช้เบอร์มือถือ 10 หลัก, เลขผู้เสียภาษี/บัตรประชาชน 13 หลัก หรือ e-Wallet ID 15 หลัก');
  }
}

function BankBadge({ code, size = 'md' }: { code: string; size?: 'sm' | 'md' }) {
  const b = bankInfo(code);
  return (
    <span className={cn('grid flex-none place-items-center rounded-xl font-bold text-white', size === 'sm' ? 'h-8 w-8 text-[10px]' : 'h-11 w-11 text-[11px]')} style={{ background: b.color }}>
      {code === 'OTHER' ? <Building2 className="h-5 w-5" /> : code.slice(0, 4)}
    </span>
  );
}

const blank = (isDefault: boolean): BankAccount => ({ id: uuid(), bankCode: 'KBANK', bankName: '', accountName: '', accountNumber: '', branch: '', promptPayId: '', swift: '', iban: '', currency: 'THB', showOnBill: true, isDefault });

/** Company accounts used for PromptPay QR and transfer details on bills. Saved in settings until changed. */
export function BankSection() {
  const d = useDraft('payments');
  const confirm = useConfirm();
  const [edit, setEdit] = useState<BankAccount | null>(null);
  const accounts = d.draft.accounts;
  const setAccounts = (list: BankAccount[]) => {
    // Exactly one default when there are accounts.
    const fixed = list.length && !list.some((a) => a.isDefault) ? list.map((a, i) => ({ ...a, isDefault: i === 0 })) : list;
    d.set('accounts', fixed);
  };
  const save = (acc: BankAccount) => {
    const exists = accounts.some((a) => a.id === acc.id);
    let list = exists ? accounts.map((a) => (a.id === acc.id ? acc : a)) : [...accounts, acc];
    if (acc.isDefault) list = list.map((a) => ({ ...a, isDefault: a.id === acc.id }));
    setAccounts(list);
    setEdit(null);
  };
  const def = accounts.find((a) => a.isDefault && a.promptPayId) ?? accounts.find((a) => a.promptPayId);

  return (
    <>
      <SectionTitle title={t('บัญชีรับเงิน')} sub={t('ผูกบัญชีของร้าน/บริษัทไว้กับระบบ ใช้สร้าง QR PromptPay ระบุยอดอัตโนมัติ และแสดงเลขบัญชีบนใบแจ้งยอด ข้อมูลอยู่จนกว่าจะเปลี่ยน')} actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(blank(accounts.length === 0))}>{t('เพิ่มบัญชี')}</Button>} />

      {def && (
        <Card>
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <QrImage data={promptPayPayload(def.promptPayId, 10000)} size={132} className="rounded-xl border border-line p-1.5" />
            <div className="flex flex-col gap-1.5 text-[14px]">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-primary"><QrCode className="h-4 w-4" />{t('QR ทดสอบ ฿100.00 จากบัญชีหลัก')}</span>
              <span className="text-[16px] font-semibold">{def.accountName}</span>
              <span className="text-muted">{bankInfo(def.bankCode).name}{def.accountNumber ? ` · ${maskAccount(def.accountNumber)}` : ''}</span>
              <span className="text-[13px] text-ink-2">{t('ลองสแกนด้วยแอปธนาคารใดก็ได้ ยอด ฿100.00 จะขึ้นให้อัตโนมัติ (ไม่ต้องโอนจริง กดยกเลิกในแอปได้)')}</span>
            </div>
          </div>
        </Card>
      )}

      <Card pad={false}>
        {accounts.length === 0 ? (
          <EmptyState icon={<Building2 className="h-6 w-6" />} title={t('ยังไม่มีบัญชีรับเงิน')} body={t('เพิ่มบัญชีธนาคารหรือหมายเลข PromptPay ของร้าน เพื่อให้ลูกค้าสแกน QR จ่ายได้ทันทีโดยไม่ต้องกรอกยอดเงิน')} action={<Button variant="primary" onClick={() => setEdit(blank(true))}>{t('เพิ่มบัญชีแรก')}</Button>} />
        ) : (
          accounts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3.5 border-b border-line-soft px-5 py-4 last:border-0">
              <BankBadge code={a.bankCode} />
              <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {a.accountName}
                  {a.isDefault && <Badge tone="success"><Star className="h-3 w-3" />{t('บัญชีหลัก')}</Badge>}
                  {a.promptPayId && <Badge tone="info">PromptPay</Badge>}
                  {!a.showOnBill && <Badge>{t('ไม่แสดงบนบิล')}</Badge>}
                </span>
                <span className="text-[13px] text-muted">{a.bankCode === 'OTHER' ? a.bankName || t('ธนาคารต่างประเทศ') : bankInfo(a.bankCode).name}{a.accountNumber ? ` · ${maskAccount(a.accountNumber)}` : ''}{a.branch ? t(' · สาขา{0}', a.branch) : ''}</span>
                {(a.swift || a.promptPayId) && <span className="font-mono text-[12px] text-faint">{[a.promptPayId && `PromptPay ${a.promptPayId}`, a.swift && `SWIFT ${a.swift}`, a.iban && `IBAN ${a.iban}`].filter(Boolean).join(' · ')}</span>}
              </div>
              {!a.isDefault && <Button size="sm" onClick={() => setAccounts(accounts.map((x) => ({ ...x, isDefault: x.id === a.id })))}>{t('ตั้งเป็นบัญชีหลัก')}</Button>}
              <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(a)}>{t('แก้ไข')}</Button>
              <Button size="sm" variant="ghost" className="text-danger" aria-label={t('ลบบัญชี {0}', a.accountName)} onClick={async () => { const r = await confirm({ title: t('ลบบัญชี {0}?', a.accountName), danger: true, confirmText: t('ลบ') }); if (r.ok) setAccounts(accounts.filter((x) => x.id !== a.id)); }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))
        )}
      </Card>

      <Card title={t('การรับเงินที่รองรับ')}>
        <ul className="grid gap-2 text-[14px] text-ink-2 md:grid-cols-2">
          <li>✓ <b>{t('QR PromptPay ระบุยอด')}</b>{' '}{t('— สแกนได้ทุกแอปธนาคารไทยและ TrueMoney ลูกค้าไม่ต้องพิมพ์ยอด')}</li>
          <li>✓ <b>{t('โอนเข้าบัญชี')}</b>{' '}{t('— แสดงชื่อ เลขบัญชี ธนาคาร บนหน้าจอและใบแจ้งยอด')}</li>
          <li>✓ <b>{t('ลูกค้าต่างประเทศ')}</b>{' '}{t('— รูดบัตรที่เครื่อง EDC ของร้าน, โอนผ่าน SWIFT/IBAN ที่แสดงบนบิล หรือแอปต่างประเทศที่รองรับ Thai QR (ขึ้นกับธนาคารของลูกค้า)')}</li>
          <li>✓ <b>{t('e-Wallet และอื่นๆ')}</b>{' '}{t('— เพิ่มได้ที่ ตั้งค่า → วิธีชำระเงิน (บันทึกยอดและเลขอ้างอิง)')}</li>
        </ul>
        <p className="text-[12px] text-muted">{t('แคชเชียร์ตรวจยอดเข้าในแอปธนาคารแล้วกดยืนยันที่ POS · การยืนยันยอดอัตโนมัติต้องสมัคร Payment Gateway กับธนาคาร (เชื่อมเพิ่มได้ภายหลัง)')}</p>
      </Card>

      <Card>
        <div className="-my-2 flex flex-col">
          <Checkbox checked={d.draft.billShowQr} onChange={(v) => d.set('billShowQr', v)} label={t('พิมพ์ QR PromptPay ระบุยอดบนใบแจ้งยอด/ใบเช็คบิลของโต๊ะ')} />
        </div>
      </Card>

      {edit && <AccountDialog value={edit} onClose={() => setEdit(null)} onSave={save} />}
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={() => void d.save()} onReset={d.reset} />
    </>
  );
}

function AccountDialog({ value, onClose, onSave }: { value: BankAccount; onClose: () => void; onSave: (a: BankAccount) => void }) {
  const [a, setA] = useState(value);
  const set = <K extends keyof BankAccount>(k: K, v: BankAccount[K]) => setA((x) => ({ ...x, [k]: v }));
  const foreign = a.bankCode === 'OTHER';
  const wallet = bankInfo(a.bankCode).wallet;
  const err = ppError(a.promptPayId);
  const valid = a.accountName.trim() && !err && (a.promptPayId || a.accountNumber.trim() || a.iban.trim());
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={value.accountName ? t('แก้ไขบัญชี') : t('เพิ่มบัญชีรับเงิน')}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('ยกเลิก')}</Button>
          <Button variant="primary" disabled={!valid} onClick={() => { onSave({ ...a, promptPayId: a.promptPayId.replace(/\D/g, ''), swift: a.swift.toUpperCase(), iban: a.iban.toUpperCase().replace(/\s/g, '') }); toast.success(t('เพิ่มในรายการแล้ว กด “บันทึก” ด้านล่างเพื่อยืนยัน')); }}>{t('ใช้ข้อมูลนี้')}</Button>
        </>
      }
    >
      <div className="grid gap-5 pb-3 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="flex flex-col gap-4">
          <Field label={t('ธนาคาร / ผู้ให้บริการ')}>
            <Select value={a.bankCode} onChange={(e) => set('bankCode', e.target.value)}>
              {BANKS.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </Select>
          </Field>
          {foreign && <Field label={t('ชื่อธนาคาร')} required><Input value={a.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder={t('เช่น DBS Bank Singapore')} /></Field>}
          <Field label={t('ชื่อบัญชี')} required hint={t('ชื่อที่ลูกค้าจะเห็นตอนโอน เช่น บริษัท ใบชา จำกัด')}><Input value={a.accountName} onChange={(e) => set('accountName', e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={wallet ? t('เบอร์ Wallet') : t('เลขที่บัญชี')}><Input inputMode="numeric" className="num" value={a.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} /></Field>
            {!wallet && <Field label={t('สาขา')}><Input value={a.branch} onChange={(e) => set('branch', e.target.value)} /></Field>}
          </div>
          <Field label={t('หมายเลข PromptPay')} hint={wallet ? t('e-Wallet ID 15 หลัก') : t('เบอร์มือถือหรือเลขผู้เสียภาษีที่ผูกกับบัญชีนี้ — ใช้สร้าง QR ระบุยอด')} error={err ?? undefined}>
            <Input inputMode="numeric" className="num" value={a.promptPayId} onChange={(e) => set('promptPayId', e.target.value.replace(/[^\d-]/g, ''))} placeholder={wallet ? t('15 หลัก') : t('0812345678 หรือ 0105561234560')} />
          </Field>
          {(foreign || a.currency !== 'THB') && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="SWIFT / BIC"><Input className="font-mono uppercase" maxLength={11} value={a.swift} onChange={(e) => set('swift', e.target.value)} /></Field>
              <Field label="IBAN" className="sm:col-span-2"><Input className="font-mono uppercase" value={a.iban} onChange={(e) => set('iban', e.target.value)} /></Field>
            </div>
          )}
          {!foreign && (
            <Field label={t('SWIFT (สำหรับรับโอนจากต่างประเทศ ถ้ามี)')}><Input className="font-mono uppercase" maxLength={11} value={a.swift} onChange={(e) => set('swift', e.target.value)} placeholder={t('เช่น KASITHBK')} /></Field>
          )}
          <Field label={t('สกุลเงิน')}>
            <Select value={a.currency} onChange={(e) => set('currency', e.target.value)}>
              {['THB', 'USD', 'EUR', 'CNY', 'JPY', 'SGD', 'MYR', 'GBP', 'KRW', 'LAK', 'MMK', 'KHR', 'VND'].map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <div className="flex flex-col">
            <Checkbox checked={a.showOnBill} onChange={(v) => set('showOnBill', v)} label={t('แสดงรายละเอียดบัญชีนี้บนใบแจ้งยอด')} />
            <Checkbox checked={a.isDefault} onChange={(v) => set('isDefault', v)} label={t('ใช้เป็นบัญชีหลักสำหรับ QR PromptPay')} />
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="text-[12px] font-medium text-muted">{t('ตัวอย่าง QR (฿100.00)')}</span>
          {a.promptPayId && !err ? <QrImage data={promptPayPayload(a.promptPayId, 10000)} size={180} className="rounded-xl border border-line p-1.5" /> : <div className="grid h-[180px] w-[180px] place-items-center rounded-xl border border-dashed border-line-strong px-4 text-center text-[12px] text-muted">{t('ใส่หมายเลข PromptPay เพื่อดู QR')}</div>}
          <BankBadge code={a.bankCode} size="sm" />
        </div>
      </div>
    </Dialog>
  );
}
