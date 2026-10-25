import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { initials, t } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { money, moneyShort, useFormatters, useSettings } from '@/lib/settings';
import { cn, qtyText } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Button, Card, ErrorState, PageHeader, Segmented, Skeleton } from '@/components/ui/core';
import { tn } from '@/lib/i18n';

interface Totals { net: number; vat: number; discount: number; cost: number; bills: number; avg: number; refunds: number }
interface Dash {
  range: { from: string; to: string; prevFrom: string; prevTo: string };
  kpis: { cur: Totals; prev: Totals };
  profit: { cur: number; prev: number } | null;
  bars: { label: string; cur: number; prev: number }[];
  top: { id: string; name: string; qty: number; rev: number; share: number }[];
  categories: { name: string; rev: number; share: number }[];
  staff: { id: string; name: string; rev: number; bills: number }[];
  adjustments: { discount: number; discountBills: number; promo: number; voids: number; voidBills: number; refunds: number; refundBills: number };
  lowStock: { id: string; name: string; qty: number; lowStock: number; unit: string; perDay: number }[];
  open: { count: number; total: number; list: { id: string; name: string; meta: string; total: number }[] };
}

const CAT_COLORS = ['#1d7a57', '#7cc4a4', '#c9b98f', '#9fb7d0', '#d6a39a', '#b6a6d6'];
const RANGE_LABEL = { today: t('วันนี้'), '7d': t('7 วัน'), '30d': t('30 วัน') } as const;

function delta(cur: number, prev: number) {
  if (!prev) return { text: cur ? t('ใหม่') : '—', up: cur >= 0 };
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return { text: `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`, up: d >= 0 };
}

function niceMax(v: number) {
  if (v <= 0) return 100000;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

export default function DashboardPage() {
  const nav = useNavigate();
  const f = useFormatters();
  const settings = useSettings();
  const [range, setRange] = useState<'today' | '7d' | '30d'>('today');
  const q = useQuery({ queryKey: ['dashboard', range], queryFn: () => api.get<Dash>('/api/reports/dashboard', { range }), refetchInterval: 60_000 });
  const d = q.data;
  const prevLabel = range === 'today' ? t('เมื่อวาน') : t('{0}ก่อนหน้า', RANGE_LABEL[range]);

  const exportCsv = () => d && api.download('/api/reports/sales', { from: d.range.from, to: d.range.to, groupBy: range === 'today' ? 'hour' : 'day', format: 'csv' }).catch((e) => toast.error(errorMessage(e)));

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} className="h-full justify-center" />;

  const kpis = d
    ? [
        { label: t('ยอดขายสุทธิ'), value: money(d.kpis.cur.net), ...delta(d.kpis.cur.net, d.kpis.prev.net), sub: `${prevLabel} ${moneyShort(d.kpis.prev.net)}` },
        { label: t('จำนวนบิล'), value: d.kpis.cur.bills.toLocaleString(), ...delta(d.kpis.cur.bills, d.kpis.prev.bills), sub: t('{0} {1} บิล', prevLabel, d.kpis.prev.bills.toLocaleString()) },
        { label: t('เฉลี่ยต่อบิล'), value: money(d.kpis.cur.avg), ...delta(d.kpis.cur.avg, d.kpis.prev.avg), sub: `${prevLabel} ${moneyShort(d.kpis.prev.avg)}` },
        d.profit
          ? { label: t('กำไรขั้นต้น'), value: money(d.profit.cur), ...delta(d.profit.cur, d.profit.prev), sub: d.kpis.cur.net ? t('มาร์จิ้น {0}%', ((d.profit.cur / Math.max(1, d.kpis.cur.net - d.kpis.cur.vat)) * 100).toFixed(1)) : '—' }
          : { label: t('ส่วนลดที่ให้'), value: money(d.kpis.cur.discount), ...delta(d.kpis.cur.discount, d.kpis.prev.discount), sub: `${prevLabel} ${moneyShort(d.kpis.prev.discount)}` },
      ]
    : [];
  const maxV = niceMax(Math.max(1, ...(d?.bars ?? []).flatMap((b) => [b.cur, b.prev])));
  const peak = d?.bars.reduce((a, b) => (b.cur > a.cur ? b : a), d.bars[0] ?? { label: '', cur: 0, prev: 0 });

  return (
    <Page>
      <PageHeader
        title={t('ภาพรวม')}
        sub={d ? (range === 'today' ? f.date(d.range.to) : `${f.date(d.range.from)} – ${f.date(d.range.to)}`) : ' '}
        actions={
          <>
            <Segmented value={range} onChange={setRange} options={(Object.keys(RANGE_LABEL) as (keyof typeof RANGE_LABEL)[]).map((k) => ({ value: k, label: RANGE_LABEL[k] }))} />
            <Button onClick={() => void exportCsv()}>{t('ส่งออก CSV')}</Button>
          </>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {!d
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className="card h-[118px] p-5"><Skeleton className="mb-3 w-24" /><Skeleton className="h-8 w-36" /></div>)
          : kpis.map((k) => (
              <div key={k.label} className="card flex flex-col gap-1 px-5 py-[18px]">
                <span className="text-[14px] text-muted">{k.label}</span>
                <span className="num text-[28px] font-semibold leading-tight">{k.value}</span>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className={cn('num rounded-full px-2 py-px font-semibold', k.up ? 'bg-soft text-soft-fg' : 'bg-danger-soft text-danger')}>{k.text}</span>
                  <span className="text-muted">{k.sub}</span>
                </div>
              </div>
            ))}
      </div>

      <div className={cn('grid gap-3', settings.modules.restaurant ? 'lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]' : '')}>
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">{range === 'today' ? t('ยอดขายรายชั่วโมง') : t('ยอดขายรายวัน')}</span>
              <span className="text-[13px] text-muted">{peak && peak.cur > 0 ? t('สูงสุด {0}{1} · {2}', peak.label, range === 'today' ? ':00' : '', money(peak.cur)) : t('ยังไม่มียอดขาย')}</span>
            </div>
            <div className="flex gap-3.5 text-[12px] text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-primary" />{RANGE_LABEL[range]}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-line-strong" />{prevLabel}</span>
            </div>
          </div>
          <div className="relative flex h-[220px] items-end pl-11" style={{ gap: (d?.bars.length ?? 0) > 16 ? 3 : 8 }} role="img" aria-label={t('กราฟยอดขาย')}>
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
              <div key={g} className="absolute left-11 right-0 border-t border-dashed border-line-soft" style={{ bottom: `${g * 100}%` }}>
                <span className="num absolute -left-11 -top-[9px] text-[11px] text-faint">{moneyShort(Math.round(maxV * g)).replace('฿', '')}</span>
              </div>
            ))}
            {d?.bars.map((b) => (
              <div key={b.label} className="group relative flex h-full min-w-0 flex-1 items-end gap-0.5" title={`${b.label}: ${money(b.cur)} (${prevLabel} ${money(b.prev)})`}>
                <div className="flex-1 rounded-[4px_4px_1px_1px] bg-line" style={{ height: `${(b.prev / maxV) * 100}%` }} />
                <div className={cn('flex-1 rounded-[4px_4px_1px_1px]', peak && b === peak && b.cur > 0 ? 'bg-primary' : 'bg-accent/80')} style={{ height: `${(b.cur / maxV) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="flex pl-11" style={{ gap: (d?.bars.length ?? 0) > 16 ? 3 : 8 }}>
            {d?.bars.map((b, i) => (
              <span key={b.label} className={cn('num min-w-0 flex-1 whitespace-nowrap text-center text-[11px] text-muted', d.bars.length > 16 && i % 6 !== 0 && 'max-sm:invisible')}>{(d.bars.length > 16 && i % 3 !== 0) ? '' : b.label}</span>
            ))}
          </div>
        </Card>
        {settings.modules.restaurant && (
          <Card>
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><span className="h-2 w-2 rounded-full bg-accent" />{t('ตอนนี้')}</span><span className="text-[13px] text-muted">{t('อัปเดตสด')}</span></div>
            <div className="num grid grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-canvas p-3"><div className="text-[12px] text-muted">{t('โต๊ะที่ยังไม่เก็บเงิน')}</div><div className="text-[22px] font-semibold">{d?.open.count ?? 0}</div></div>
              <div className="rounded-xl bg-canvas p-3"><div className="text-[12px] text-muted">{t('ยอดรอเก็บ')}</div><div className="text-[22px] font-semibold">{money(d?.open.total ?? 0)}</div></div>
            </div>
            <div className="flex flex-col">
              {d?.open.list.map((o) => (
                <button key={o.id} onClick={() => nav(`/pos?order=${o.id}`)} className="flex w-full items-center gap-2.5 border-b border-line-soft px-1 py-2.5 text-left hover:bg-sunken">
                  <span className="flex flex-1 flex-col"><span className="text-[15px] font-medium">{o.name}</span><span className="text-[12px] text-muted">{o.meta}</span></span>
                  <span className="num font-semibold">{money(o.total)}</span><span className="text-faint">›</span>
                </button>
              ))}
              {d && !d.open.count && <span className="py-3 text-[14px] text-muted">{t('ไม่มีโต๊ะค้างเก็บเงิน')}</span>}
            </div>
          </Card>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex justify-between"><span className="font-semibold">{t('สินค้าขายดี')}</span><span className="text-[13px] text-muted">{t('ตามยอดขาย')}</span></div>
          <div className="flex flex-col">
            <div className="grid grid-cols-[22px_minmax(0,1fr)_56px_84px] gap-2.5 border-b border-line-soft pb-1.5 text-[12px] text-muted"><span /><span>{t('สินค้า')}</span><span className="text-right">{t('จำนวน')}</span><span className="text-right">{t('ยอดขาย')}</span></div>
            {d?.top.map((t, i) => (
              <div key={t.id} className="num grid grid-cols-[22px_minmax(0,1fr)_56px_84px] items-center gap-2.5 border-b border-line-soft py-2.5">
                <span className="font-mono text-[12px] font-semibold text-faint">{i + 1}</span>
                <span className="flex min-w-0 flex-col gap-1.5"><span className="truncate text-[14px]">{t.name}</span><span className="h-1 overflow-hidden rounded-full bg-line-soft"><span className="block h-full rounded-full bg-[#7cc4a4]" style={{ width: `${Math.max(2, t.share * 100)}%` }} /></span></span>
                <span className="text-right text-[14px] text-ink-2">{qtyText(t.qty)}</span>
                <span className="text-right text-[14px] font-semibold">{moneyShort(t.rev)}</span>
              </div>
            ))}
            {d && !d.top.length && <span className="py-6 text-center text-[14px] text-muted">{t('ยังไม่มียอดขายในช่วงนี้')}</span>}
          </div>
        </Card>
        <Card>
          <span className="font-semibold">{t('ยอดขายตามหมวด')}</span>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-md">
            {d?.categories.map((c, i) => <div key={c.name} style={{ width: `${c.share * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />)}
          </div>
          <div className="flex flex-col">
            {d?.categories.map((c, i) => (
              <div key={c.name} className="num flex items-center gap-2.5 border-b border-line-soft py-2.5 text-[14px]">
                <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-muted">{(c.share * 100).toFixed(0)}%</span>
                <span className="w-[76px] text-right font-semibold">{moneyShort(c.rev)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <span className="font-semibold">{t('พนักงาน')}</span>
          <div className="flex flex-col">
            {d?.staff.map((p) => (
              <div key={p.id} className="num flex items-center gap-2.5 border-b border-line-soft py-2.5">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-soft text-[12px] font-semibold text-soft-fg">{initials(p.name)}</span>
                <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-[14px]">{p.name}</span><span className="text-[12px] text-muted">{tn('{0} บิล', p.bills)}</span></span>
                <span className="text-[14px] font-semibold">{moneyShort(p.rev)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {settings.modules.stock && (
          <Card title={t('สต็อกต้องดูแล')} action={<button onClick={() => nav('/stock')} className="h-9 text-[14px] font-semibold text-primary">{t('ไปหน้าสต็อก ›')}</button>}>
            <div className="flex flex-col">
              {d?.lowStock.map((l) => {
                const days = l.perDay > 0 ? Math.floor(l.qty / l.perDay) : null;
                const out = l.qty <= 0;
                return (
                  <div key={l.id} className="flex items-center gap-2.5 border-b border-line-soft py-2.5 text-[14px]">
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="text-[12px] text-muted">{l.perDay ? t('ขาย ~{0}/วัน', l.perDay) : ''}</span>
                    <span className={cn('min-w-[72px] whitespace-nowrap rounded-full px-2.5 py-[3px] text-center text-[12px] font-semibold', out ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn')}>
                      {out ? t('หมดแล้ว') : t('เหลือ {0}{1}', qtyText(l.qty), days !== null ? t(' (~{0} วัน)', days) : '')}
                    </span>
                  </div>
                );
              })}
              {d && !d.lowStock.length && <span className="py-3 text-[14px] text-muted">{t('สต็อกทุกรายการอยู่ในระดับปกติ')}</span>}
            </div>
          </Card>
        )}
        <Card title={t('ส่วนลดและการยกเลิก')}>
          {d && (
            <div className="num flex flex-col">
              {[
                { label: t('ส่วนลดที่ให้'), meta: t('{0} บิล', d.adjustments.discountBills), value: `-${money(d.adjustments.discount)}`, tone: 'text-ink' },
                { label: t('จากโปรโมชั่น'), meta: t('รวมในส่วนลด'), value: money(d.adjustments.promo), tone: 'text-muted' },
                { label: t('คืนสินค้า'), meta: t('{0} รายการ', d.adjustments.refundBills), value: money(d.adjustments.refunds), tone: 'text-warn' },
                { label: t('ยกเลิกบิล'), meta: t('{0} บิล', d.adjustments.voidBills), value: money(d.adjustments.voids), tone: 'text-danger' },
              ].map((j) => (
                <div key={j.label} className="flex items-center gap-2.5 border-b border-line-soft py-2.5 text-[14px]">
                  <span className="flex flex-1 flex-col"><span>{j.label}</span><span className="text-[12px] text-muted">{j.meta}</span></span>
                  <span className={cn('font-semibold', j.tone)}>{j.value}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}
