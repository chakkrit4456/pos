import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import {
  BarChart3,
  Boxes,
  ChefHat,
  ClipboardList,
  HelpCircle,
  LayoutGrid,
  Lock,
  LogOut,
  Package,
  Percent,
  Receipt,
  Settings as SettingsIcon,
  ShoppingCart,
  Timer,
  Users,
  UtensilsCrossed,
  FileBarChart,
} from 'lucide-react';
import { initials, type Permission } from '@flexpos/shared';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { LockScreen } from '@/pages/LockScreen';
import { CommandPalette } from './CommandPalette';
import { LicenseBanner } from './LicenseBanner';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  perm?: Permission;
  show?: boolean;
}

export function useNavItems(): NavItem[] {
  const s = useSettings();
  const { can } = useSession();
  const m = s.modules;
  const items: NavItem[] = [
    { to: '/pos', label: 'ขาย', icon: <ShoppingCart />, perm: 'pos.sell' },
    { to: '/tables', label: 'โต๊ะ', icon: <UtensilsCrossed />, perm: 'tables.manage', show: m.restaurant },
    { to: '/orders', label: 'ออเดอร์', icon: <ClipboardList />, perm: 'tables.manage', show: m.restaurant },
    { to: '/kitchen', label: 'ครัว', icon: <ChefHat />, perm: 'kitchen.view', show: m.restaurant && m.kitchenDisplay },
    { to: '/sales', label: 'บิล', icon: <Receipt /> },
    { to: '/dashboard', label: 'ภาพรวม', icon: <BarChart3 />, perm: 'reports.view' },
    { to: '/products', label: 'สินค้า', icon: <Package />, perm: 'products.view' },
    { to: '/stock', label: 'สต็อก', icon: <Boxes />, perm: 'stock.view', show: m.stock },
    { to: '/customers', label: 'สมาชิก', icon: <Users />, perm: 'customers.view', show: m.members },
    { to: '/promotions', label: 'โปรฯ', icon: <Percent />, perm: 'promotions.manage', show: m.promotions },
    { to: '/reports', label: 'รายงาน', icon: <FileBarChart />, perm: 'reports.view' },
    { to: '/shift', label: 'กะ', icon: <Timer />, perm: 'shift.manage' },
    { to: '/settings', label: 'ตั้งค่า', icon: <SettingsIcon />, perm: 'settings.manage' },
  ];
  return items.filter((i) => i.show !== false && (!i.perm || can(i.perm)));
}

function useAutoLock(minutes: number, lock: () => void) {
  useEffect(() => {
    if (!minutes) return;
    let t: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(lock, minutes * 60_000);
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes, lock]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const items = useNavItems();
  const { user, locked, lock, logout } = useSession();
  const settings = useSettings();
  const nav = useNavigate();
  const [palette, setPalette] = useState(false);
  useAutoLock(settings.pos.autoLockMinutes, lock);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const avatar = useMemo(() => initials(user?.name ?? '') || '?', [user?.name]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas md:flex-row">
      <nav className="order-last flex flex-none items-center gap-1 overflow-x-auto bg-rail px-2 py-1.5 md:order-first md:w-[84px] md:flex-col md:overflow-y-auto md:overflow-x-hidden md:px-0 md:py-4" aria-label="เมนูหลัก">
        <button onClick={() => nav('/')} className="mb-3 hidden h-11 w-11 flex-none place-items-center rounded-xl bg-accent text-[18px] font-bold text-white md:grid" aria-label="หน้าแรก">
          F
        </button>
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            className={({ isActive }) =>
              cn(
                'flex h-[56px] w-[64px] flex-none flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-medium transition-colors md:w-[68px] [&_svg]:h-[19px] [&_svg]:w-[19px]',
                isActive ? 'bg-rail-2 text-white' : 'text-[#a5a8ad] hover:bg-rail-2/60 hover:text-white',
              )
            }
          >
            {i.icon}
            <span className="leading-none">{i.label}</span>
          </NavLink>
        ))}
        <div className="hidden flex-1 md:block" />
        <Popover.Root>
          <Popover.Trigger asChild>
            <button className="ml-auto grid h-10 w-10 flex-none place-items-center rounded-full bg-rail-2 text-[14px] font-semibold text-white md:ml-0 md:mt-2" aria-label={`ผู้ใช้ ${user?.name ?? ''}`}>
              {avatar}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="right" align="end" sideOffset={10} className="z-50 w-64 animate-pop-in rounded-2xl border border-line bg-surface p-2 shadow-pop">
              <div className="px-3 py-2">
                <div className="font-semibold">{user?.name}</div>
                <div className="text-[13px] text-muted">{user?.roleName}</div>
              </div>
              <MenuButton icon={<Lock className="h-4 w-4" />} onClick={lock}>
                สลับพนักงาน / ล็อกหน้าจอ
              </MenuButton>
              <MenuButton icon={<LayoutGrid className="h-4 w-4" />} onClick={() => setPalette(true)}>
                ค้นหาเมนู <span className="ml-auto font-mono text-[12px] text-faint">Ctrl K</span>
              </MenuButton>
              <MenuButton icon={<HelpCircle className="h-4 w-4" />} onClick={() => nav('/help')}>
                ช่วยเหลือ
              </MenuButton>
              <MenuButton icon={<LogOut className="h-4 w-4" />} onClick={() => void logout()} danger>
                ออกจากระบบ
              </MenuButton>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <LicenseBanner />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      {locked && <LockScreen />}
    </div>
  );
}

function MenuButton({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <Popover.Close asChild>
      <button onClick={onClick} className={cn('flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] hover:bg-sunken', danger && 'text-danger')}>
        {icon}
        {children}
      </button>
    </Popover.Close>
  );
}

/** Standard scrolling page container used by back-office pages. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className="scroll-thin h-full overflow-y-auto">
      <div className={cn('mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-5 md:px-8 md:py-7', className)}>{children}</div>
    </main>
  );
}
