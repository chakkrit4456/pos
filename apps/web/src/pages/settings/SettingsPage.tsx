import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Select } from '@/components/ui/core';
import { ModulesSection, PaymentsSection, PosSection, ReceiptSection, StoreSection, TaxSection } from './StoreSections';
import { BranchesSection, DevicesSection, PrintersSection } from './DeviceSections';
import { TablesSection } from './TablesSection';
import { BrandSection } from './BrandSection';
import { BankSection } from './BankSection';
import { AuditSection, LicenseSection, RolesSection, StaffSection } from './AdminSections';
import { BackupSection } from './BackupSection';
import { CustomFieldsSection } from './CustomFieldsSection';

const SECTIONS = [
  { id: 'store', label: 'ข้อมูลร้าน', el: StoreSection },
  { id: 'receipt', label: 'ใบเสร็จ', el: ReceiptSection },
  { id: 'tax', label: 'ภาษีและค่าบริการ', el: TaxSection },
  { id: 'banks', label: 'บัญชีรับเงิน', el: BankSection },
  { id: 'payments', label: 'วิธีชำระเงิน', el: PaymentsSection },
  { id: 'pos', label: 'หน้าขาย', el: PosSection },
  { id: 'modules', label: 'โมดูลและฟีเจอร์', el: ModulesSection },
  { id: 'brand', label: 'หน้าตาและภาษา', el: BrandSection },
  { id: 'printers', label: 'เครื่องพิมพ์', el: PrintersSection },
  { id: 'devices', label: 'อุปกรณ์และเครือข่าย', el: DevicesSection },
  { id: 'tables', label: 'โต๊ะและโซน', el: TablesSection, module: 'restaurant' as const },
  { id: 'branches', label: 'สาขา', el: BranchesSection, module: 'multiBranch' as const },
  { id: 'staff', label: 'พนักงาน', el: StaffSection },
  { id: 'roles', label: 'บทบาทและสิทธิ์', el: RolesSection },
  { id: 'fields', label: 'ฟิลด์เพิ่มเติม', el: CustomFieldsSection },
  { id: 'backup', label: 'สำรองข้อมูล', el: BackupSection },
  { id: 'license', label: 'License', el: LicenseSection },
  { id: 'audit', label: 'บันทึกการใช้งาน', el: AuditSection },
];

export default function SettingsPage() {
  const { section = 'store' } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const visible = SECTIONS.filter((s) => !s.module || settings.modules[s.module]);
  const current = visible.find((s) => s.id === section) ?? visible[0]!;
  const El = current.el;
  return (
    <Page className="max-w-[1280px]">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <label className="flex flex-col gap-1.5 lg:hidden">
          <span className="text-[13px] font-medium text-muted">หมวดการตั้งค่า</span>
          <Select value={current.id} onChange={(e) => nav(`/settings/${e.target.value}`)} className="h-12 text-[16px] font-semibold">
            {visible.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <nav className="hidden flex-none gap-1 lg:sticky lg:top-0 lg:flex lg:w-[220px] lg:flex-col" aria-label="หมวดการตั้งค่า">
          <h1 className="mb-3 hidden text-[28px] font-semibold lg:block">ตั้งค่า</h1>
          {visible.map((s) => (
            <button key={s.id} onClick={() => nav(`/settings/${s.id}`)} className={cn('flex h-11 flex-none items-center whitespace-nowrap rounded-[10px] px-3.5 text-left text-[15px]', s.id === current.id ? 'bg-surface font-semibold text-ink shadow-card' : 'text-ink-2 hover:bg-sunken')}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <El />
        </div>
      </div>
    </Page>
  );
}
