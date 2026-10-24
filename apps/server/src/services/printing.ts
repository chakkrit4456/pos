import type { PrintDoc } from '@flexpos/shared';
import { buildKitchenTicket } from '@flexpos/shared';
import type { PrintersTable } from '@flexpos/db';
import type { AppContext, Tx } from '../context.js';
import { nowIso, parseJson, uuid } from '../util.js';
import { buildEscPos, probe, sendRaw } from './escpos.js';

export class PrintService {
  private timer: NodeJS.Timeout | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly fontsDir?: string,
  ) {}

  start() {
    this.timer = setInterval(() => void this.process(), 3000);
    this.probeTimer = setInterval(() => void this.probeAll(), 20_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.probeTimer) clearInterval(this.probeTimer);
  }

  async send(p: Pick<PrintersTable, 'address' | 'port' | 'text_mode' | 'paper'>, doc: PrintDoc) {
    const data = await buildEscPos({ ...doc, paper: doc.paper === 'A4' ? (p.paper as '58' | '80') : doc.paper }, p.text_mode === 'thai' ? 'thai' : 'image', this.fontsDir);
    await sendRaw(p.address, p.port, data);
  }

  async enqueue(tx: Tx, printerId: string, kind: string, title: string, doc: PrintDoc): Promise<string> {
    const id = uuid();
    await tx
      .insertInto('print_jobs')
      .values({ id, printer_id: printerId, kind, title, payload: JSON.stringify(doc), status: 'queued', attempts: 0, error: '', created_at: nowIso(), printed_at: null })
      .execute();
    setImmediate(() => void this.process());
    return id;
  }

  async process(): Promise<void> {
    if (this.busy || !this.ctx.conn) return;
    this.busy = true;
    try {
      const jobs = await this.ctx.db.selectFrom('print_jobs').selectAll().where('status', '=', 'queued').orderBy('created_at').limit(20).execute();
      const failedPrinters = new Set<string>();
      for (const j of jobs) {
        if (failedPrinters.has(j.printer_id)) continue;
        const p = await this.ctx.db.selectFrom('printers').selectAll().where('id', '=', j.printer_id).executeTakeFirst();
        if (!p || p.active !== 1 || p.kind !== 'network') {
          await this.ctx.db.updateTable('print_jobs').set({ status: 'failed', error: 'เครื่องพิมพ์ถูกปิดหรือถูกลบ' }).where('id', '=', j.id).execute();
          continue;
        }
        try {
          await this.send(p, parseJson<PrintDoc>(j.payload, { paper: '80', blocks: [] }));
          await this.ctx.db.updateTable('print_jobs').set({ status: 'done', printed_at: nowIso(), attempts: j.attempts + 1 }).where('id', '=', j.id).execute();
          if (p.online !== 1) await this.setOnline(p.id, true, '');
        } catch (e) {
          failedPrinters.add(p.id);
          const msg = e instanceof Error ? e.message : String(e);
          await this.ctx.db.updateTable('print_jobs').set({ attempts: j.attempts + 1, error: msg }).where('id', '=', j.id).execute();
          await this.setOnline(p.id, false, msg);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async setOnline(id: string, online: boolean, error: string) {
    await this.ctx.db.updateTable('printers').set({ online: online ? 1 : 0, last_error: error }).where('id', '=', id).execute();
    const q = await this.ctx.db.selectFrom('print_jobs').select((eb) => eb.fn.countAll<number>().as('n')).where('printer_id', '=', id).where('status', '=', 'queued').executeTakeFirst();
    this.ctx.emit({ type: 'printer.status', printerId: id, online, queued: Number(q?.n ?? 0) });
  }

  async probeAll(): Promise<void> {
    if (!this.ctx.conn) return;
    const printers = await this.ctx.db.selectFrom('printers').selectAll().where('active', '=', 1).where('kind', '=', 'network').execute();
    for (const p of printers) {
      const ok = await probe(p.address, p.port);
      if (ok !== (p.online === 1)) await this.setOnline(p.id, ok, ok ? '' : 'ไม่พบเครื่องพิมพ์ในเครือข่าย');
    }
    void this.process();
  }

  /**
   * Route kitchen items to printers by category. A kitchen/bar printer with no categories
   * receives every item not claimed by a more specific printer.
   */
  async printKitchen(
    tx: Tx,
    branchId: string,
    ticket: { title: string; ticketNo: string; by: string; createdAt: string },
    items: { categoryId: string | null; qty: number; name: string; modifiers: string[]; note: string }[],
    reprint = false,
  ): Promise<number> {
    if (!this.ctx.settings.kitchen.autoPrint && !reprint) return 0;
    const printers = await tx
      .selectFrom('printers')
      .selectAll()
      .where('active', '=', 1)
      .where('branch_id', '=', branchId)
      .where('role', 'in', ['kitchen', 'bar'])
      .where('kind', '=', 'network')
      .execute();
    if (printers.length === 0) return 0;
    const specific = printers.map((p) => ({ p, cats: parseJson<string[]>(p.category_ids, []) }));
    const buckets = new Map<string, typeof items>();
    for (const it of items) {
      let targets = specific.filter((s) => s.cats.length > 0 && it.categoryId && s.cats.includes(it.categoryId));
      if (targets.length === 0) targets = specific.filter((s) => s.cats.length === 0);
      for (const t of targets) {
        const arr = buckets.get(t.p.id) ?? [];
        arr.push(it);
        buckets.set(t.p.id, arr);
      }
    }
    for (const [pid, list] of buckets) {
      const p = printers.find((x) => x.id === pid)!;
      const doc = buildKitchenTicket({
        ...ticket,
        station: p.name,
        items: this.ctx.settings.kitchen.showModifiers ? list : list.map((l) => ({ ...l, modifiers: [] })),
        era: this.ctx.settings.locale.era,
        paper: p.paper === '58' ? '58' : '80',
        reprint,
      });
      await this.enqueue(tx, pid, 'kitchen', `${ticket.title} #${ticket.ticketNo}`, doc);
    }
    return buckets.size;
  }
}
