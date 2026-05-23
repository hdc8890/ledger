'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isNavItemActive } from './nav-items';

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 md:hidden"
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors',
              active
                ? 'text-neutral-900 dark:text-neutral-100'
                : 'text-neutral-500 dark:text-neutral-400',
            )}
          >
            <item.icon className="h-5 w-5" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
