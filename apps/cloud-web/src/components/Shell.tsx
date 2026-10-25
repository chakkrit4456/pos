import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Cloud, LogOut, Shield, Store, UserRound } from 'lucide-react';
import { getLanguage, t } from '@flexpos/shared';
import { cn } from '@/lib/utils';
import { switchLanguage } from '@/lib/i18n';
import { useSession } from '~/lib/session';

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const link = ({ isActive }: { isActive: boolean }) => cn('flex h-10 items-center gap-2 rounded-xl px-3 text-[14px]', isActive ? 'bg-rail-2 font-semibold text-rail-fg' : 'text-rail-muted hover:text-rail-fg');
  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <header className="sticky top-0 z-30 bg-rail text-rail-fg">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-2 px-4 md:px-8">
          <Link to="/" className="mr-2 flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white"><Cloud className="h-4 w-4" /></span>
            <span className="hidden sm:inline">FlexPOS Cloud</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={link}><Store className="h-4 w-4" /><span className="hidden sm:inline">{t('ร้านของฉัน')}</span></NavLink>
            {user?.isSuperadmin && <NavLink to="/admin" className={link}><Shield className="h-4 w-4" /><span className="hidden sm:inline">{t('ผู้ดูแลระบบ')}</span></NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <button className="h-10 rounded-xl px-3 text-[13px] text-rail-muted hover:text-rail-fg" onClick={() => switchLanguage(getLanguage() === 'th' ? 'en' : 'th')}>{getLanguage() === 'th' ? 'EN' : 'ไทย'}</button>
            <NavLink to="/account" className={link} title={user?.email}><UserRound className="h-4 w-4" /><span className="hidden max-w-[180px] truncate md:inline">{user?.name}</span></NavLink>
            <button className="grid h-10 w-10 place-items-center rounded-xl text-rail-muted hover:text-rail-fg" onClick={() => void logout()} aria-label={t('ออกจากระบบ')} title={t('ออกจากระบบ')}><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-5 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="scroll-thin -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" aria-selected={value === tb.id} onClick={() => onChange(tb.id)} className={cn('h-11 whitespace-nowrap border-b-2 px-3 text-[15px]', value === tb.id ? 'border-primary font-semibold text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}
