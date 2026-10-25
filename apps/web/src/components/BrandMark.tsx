import { cn } from '@/lib/utils';

/** App logo (uploaded image) or the first letter of the app name on the accent color. */
export function BrandMark({ logo, name, className }: { logo?: string; name?: string; className?: string }) {
  return logo ? (
    <img src={logo} alt="" className={cn('h-11 w-11 flex-none rounded-xl bg-white object-contain p-0.5', className)} />
  ) : (
    <span className={cn('grid h-11 w-11 flex-none place-items-center rounded-xl bg-accent text-[18px] font-bold text-white', className)}>{(name || 'F').slice(0, 1)}</span>
  );
}
