import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import {
  BarChart3,
  Boxes,
  ChefHat,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  HelpCircle,
  Lock,
  LogOut,
  Menu,
  Package,
  Percent,
  Receipt,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Timer,
  Users,
  UtensilsCrossed,
  FileBarChart,
  ChevronsUpDown,
  X,
} from 'lucide-react';
import { initials, type Permission } from '@flexpos/shared';
import { useSession } from '@/lib/session';
import { useBrand, useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { LockScreen } from '@/pages/LockScreen';
import { CommandPalette } from './CommandPalette';
import { LicenseBanner } from './LicenseBanner';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  group: NavGroup;
  perm?: Permission;
  show?: boolean;
}

type NavGroup = 'sell' | 'manage' | 'insight' | 'system';
const GROUP_LABEL: Record<NavGroup, string> = { sell: 'การขาย', manage: 'จัดการร้าน', insight: 'วิเคราะห์', system: 'ระบบ' };

export function useNavItems(): NavItem[] {
  const s = useSettings();
  const { can } = useSession();
  const m = s.modules;
  const items: NavItem[] = [
    { to: '/pos', label: 'หน้าขาย', icon: <ShoppingCart />, group: 'sell', perm: 'pos.sell' },
    { to: '/tables', label: 'โต๊ะ', icon: <UtensilsCrossed />, group: 'sell', perm: 'tables.manage', show: m.restaurant },
    { to: '/orders', label: 'ออเดอร์', icon: <ClipboardList />, group: 'sell', perm: 'tables.manage', show: m.restaurant },
    { to: '/kitchen', label: 'จอครัว', icon: <ChefHat />, group: 'sell', perm: 'kitchen.view', show: m.restaurant && m.kitchenDisplay },
    { to: '/sales', label: 'บิลขาย', icon: <Receipt />, group: 'sell' },
    { to: '/shift', label: 'กะการทำงาน', icon: <Timer />, group: 'sell', perm: 'shift.manage' },
    { to: '/products', label: 'สินค้า', icon: <Package />, group: 'manage', perm: 'products.view' },
    { to: '/stock', label: 'สต็อก', icon: <Boxes />, group: 'manage', perm: 'stock.view', show: m.stock },
    { to: '/customers', label: 'สมาชิก', icon: <Users />, group: 'manage', perm: 'customers.view', show: m.members },
    { to: '/promotions', label: 'โปรโมชั่น', icon: <Percent />, group: 'manage', perm: 'promotions.manage', show: m.promotions },
    { to: '/dashboard', label: 'ภาพรวม', icon: <BarChart3 />, group: 'insight', perm: 'reports.view' },
    { to: '/reports', label: 'รายงาน', icon: <FileBarChart />, group: 'insight', perm: 'reports.view' },
    { to: '/settings', label: 'ตั้งค่า', icon: <SettingsIcon />, group: 'system', perm: 'settings.manage' },
    { to: '/help', label: 'ช่วยเหลือ', icon: <HelpCircle />, group: 'system' },
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

const COLLAPSE_KEY = 'flexpos.sidebar.collapsed';
/** Screens that need the full width start with the sidebar collapsed. */
const FOCUS_ROUTES = ['/pos', '/kitchen'];

export function AppShell({ children }: { children: ReactNode }) {
  const items = useNavItems();
  const { user, locked, lock } = useSession();
  const settings = useSettings();
  const brand = useBrand();
  const loc = useLocation();
  const [palette, setPalette] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // null = automatic (collapse on tablet widths), true/false = the user's choice.
  const [pref, setPref] = useState<boolean | null>(() => {
    try {
      const v = localStorage.getItem(COLLAPSE_KEY);
      return v === null ? null : v === '1';
    } catch {
      return null;
    }
  });
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 1179px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width: 1179px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const focus = FOCUS_ROUTES.some((r) => loc.pathname.startsWith(r));
  const collapsed = focus || (pref ?? narrow);
  useAutoLock(settings.pos.autoLockMinutes, lock);

  useEffect(() => setMobileOpen(false), [loc.pathname]);
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

  const toggle = () => {
    const next = !collapsed;
    setPref(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const current = items.find((i) => loc.pathname.startsWith(i.to));

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      {/* Desktop sidebar */}
      <aside className={cn('hidden flex-none flex-col bg-rail text-rail-fg transition-[width] duration-200 md:flex', collapsed ? 'w-[76px]' : 'w-[248px]')} aria-label="เมนูหลัก">
        <SidebarBody items={items} collapsed={collapsed} storeName={settings.store.name} appName={brand.appName} logo={brand.logo} onSearch={() => setPalette(true)} />
        {!focus && (
          <button onClick={toggle} className="flex h-11 flex-none items-center justify-center gap-2 border-t border-rail-hover/10 text-[13px] text-rail-muted hover:bg-rail-hover/5 hover:text-rail-fg" aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" />ย่อเมนู</>}
          </button>
        )}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 animate-fade-in bg-[rgb(23_25_28/0.5)]" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[272px] animate-pop-in flex-col bg-rail text-rail-fg shadow-pop" aria-label="เมนูหลัก">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-lg text-rail-muted hover:bg-rail-hover/10" aria-label="ปิดเมนู">
              <X className="h-5 w-5" />
            </button>
            <SidebarBody items={items} collapsed={false} storeName={settings.store.name} appName={brand.appName} logo={brand.logo} onSearch={() => setPalette(true)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 flex-none items-center gap-3 border-b border-line bg-surface px-3 md:hidden">
          <button onClick={() => setMobileOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-sunken" aria-label="เปิดเมนู">
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex-1 truncate text-[16px] font-semibold">{current?.label ?? settings.store.name}</span>
          <button onClick={() => setPalette(true)} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-sunken" aria-label="ค้นหา">
            <Search className="h-5 w-5" />
          </button>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-soft text-[13px] font-semibold text-soft-fg">{initials(user?.name ?? '') || '?'}</span>
        </header>
        <LicenseBanner />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      {locked && <LockScreen />}
    </div>
  );
}

function SidebarBody({ items, collapsed, storeName, appName, logo, onSearch }: { items: NavItem[]; collapsed: boolean; storeName: string; appName: string; logo: string; onSearch: () => void }) {
  const nav = useNavigate();
  const groups = (Object.keys(GROUP_LABEL) as NavGroup[]).map((g) => ({ g, list: items.filter((i) => i.group === g) })).filter((x) => x.list.length);
  return (
    <>
      <button onClick={() => nav('/')} className={cn('flex flex-none items-center gap-3 px-4 pb-4 pt-5 text-left', collapsed && 'justify-center px-0')} aria-label="หน้าแรก">
        {logo ? (
          <img src={logo} alt="" className="h-10 w-10 flex-none rounded-xl bg-white object-contain p-0.5" />
        ) : (
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent text-[17px] font-bold text-white">{(appName || 'F').slice(0, 1)}</span>
        )}
        {!collapsed && (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-semibold leading-tight">{storeName || appName}</span>
            <span className="truncate text-[12px] text-rail-faint">{appName}</span>
          </span>
        )}
      </button>

      <div className={cn('flex-none px-3 pb-2', collapsed && 'px-2')}>
        <button onClick={onSearch} title="ค้นหา (Ctrl K)" className={cn('flex h-10 w-full items-center gap-2.5 rounded-xl bg-rail-hover/[0.06] px-3 text-[14px] text-rail-muted ring-1 ring-rail-hover/10 hover:bg-rail-hover/10 hover:text-rail-fg', collapsed && 'justify-center px-0')}>
          <Search className="h-4 w-4 flex-none" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">ค้นหา</span>
              <span className="font-mono text-[11px] text-rail-faint">Ctrl K</span>
            </>
          )}
        </button>
      </div>

      <nav className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-2">
        {groups.map(({ g, list }) => (
          <div key={g} className="flex flex-col gap-0.5">
            {collapsed ? <div className="mx-auto mb-1 h-px w-8 bg-rail-hover/10 first:hidden" /> : <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-rail-faint">{GROUP_LABEL[g]}</div>}
            {list.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                title={collapsed ? i.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'group relative flex h-11 items-center gap-3 rounded-xl px-3 text-[14.5px] font-medium transition-colors [&_svg]:h-[19px] [&_svg]:w-[19px] [&_svg]:flex-none',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-rail-hover/[0.1] text-rail-fg' : 'text-rail-muted hover:bg-rail-hover/[0.05] hover:text-rail-fg',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 top-2.5 h-6 w-[3px] rounded-r-full bg-accent" />}
                    <span className={cn(isActive && '[&_svg]:text-accent')}>{i.icon}</span>
                    {!collapsed && <span className="truncate">{i.label}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <UserMenu collapsed={collapsed} />
    </>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, lock, logout } = useSession();
  const nav = useNavigate();
  const avatar = useMemo(() => initials(user?.name ?? '') || '?', [user?.name]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={cn('m-3 flex flex-none items-center gap-3 rounded-xl p-2 text-left hover:bg-rail-hover/[0.06]', collapsed && 'mx-auto justify-center')} aria-label={`ผู้ใช้ ${user?.name ?? ''}`}>
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-accent to-primary text-[13px] font-semibold text-white">{avatar}</span>
          {!collapsed && (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-medium">{user?.name}</span>
                <span className="truncate text-[12px] text-rail-faint">{user?.roleName}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 text-rail-faint" />
            </>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="right" align="end" sideOffset={12} className="z-50 w-64 animate-pop-in rounded-2xl border border-line bg-surface p-2 shadow-pop">
          <div className="px-3 py-2">
            <div className="font-semibold">{user?.name}</div>
            <div className="text-[13px] text-muted">{user?.roleName} · {user?.username}</div>
          </div>
          <MenuButton icon={<Lock className="h-4 w-4" />} onClick={lock}>สลับพนักงาน / ล็อกหน้าจอ</MenuButton>
          <MenuButton icon={<HelpCircle className="h-4 w-4" />} onClick={() => nav('/help')}>ช่วยเหลือ</MenuButton>
          <MenuButton icon={<LogOut className="h-4 w-4" />} onClick={() => void logout()} danger>ออกจากระบบ</MenuButton>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
      <div className={cn('mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-5 md:px-8 md:py-8', className)}>{children}</div>
    </main>
  );
}
