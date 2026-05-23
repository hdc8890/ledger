import {
  Building2,
  LayoutDashboard,
  Landmark,
  MessageSquare,
  Settings,
  TrendingUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Net Worth', icon: LayoutDashboard },
  { href: '/cash-flow', label: 'Cash Flow', icon: TrendingUp },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/accounts', label: 'Accounts', icon: Building2 },
  { href: '/assets', label: 'Assets', icon: Landmark },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/** Returns true when `pathname` is or is nested under `href`. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}
