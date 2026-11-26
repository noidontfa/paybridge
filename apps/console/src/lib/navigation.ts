import {
  BookOpenIcon,
  CreditCardIcon,
  FileClockIcon,
  GaugeIcon,
  KeyRoundIcon,
  LandmarkIcon,
  OctagonAlertIcon,
  ReceiptIcon,
  SettingsIcon,
  UsersIcon,
  WebhookIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  title: string;
  /** Absent means the item has no route (it is disabled). */
  url?: string;
  icon: LucideIcon;
  badge?: string;
  /** A count the sidebar fetches and shows beside the item. */
  liveBadge?: 'openReviews';
}

export interface NavSection {
  /** Absent for ungrouped items. */
  label?: string;
  items: NavItem[];
}

export const PRODUCT_NAME = 'PayBridge Console';

// "Exceptions" is a UI label only: the domain term stays Review (see the map).
export const mainNav: NavSection[] = [
  { items: [{ title: 'Overview', url: '/', icon: GaugeIcon }] },
  {
    label: 'Payments',
    items: [
      { title: 'Payments', url: '/payments', icon: CreditCardIcon },
      { title: 'Exceptions', url: '/exceptions', icon: OctagonAlertIcon, liveBadge: 'openReviews' },
    ],
  },
  {
    items: [
      { title: 'Refunds', icon: ReceiptIcon, badge: 'Soon' },
      { title: 'Gateways', url: '/gateways', icon: LandmarkIcon },
    ],
  },
  {
    label: 'Developers',
    items: [
      { title: 'Callbacks', url: '/callbacks', icon: WebhookIcon },
      { title: 'Events', url: '/events', icon: ZapIcon },
      { title: 'Audit log', url: '/audit-log', icon: FileClockIcon },
    ],
  },
];

export const secondaryNav: NavItem[] = [
  { title: 'Users', url: '/settings/users', icon: UsersIcon },
  { title: 'Settings', url: '/settings', icon: SettingsIcon },
  { title: 'API Keys', url: '/settings/api-keys', icon: KeyRoundIcon },
  { title: 'Docs', url: '/docs', icon: BookOpenIcon },
];

export function isActivePath(pathname: string, url: string): boolean {
  if (url === '/') return pathname === '/';
  return pathname === url || pathname.startsWith(`${url}/`);
}

/** Breadcrumb trail for a pathname, derived from the navigation. */
export function breadcrumbFor(pathname: string, current?: string): { title: string; url?: string }[] {
  const all = [...mainNav.flatMap((s) => s.items), ...secondaryNav];
  const match = all.find((i) => i.url && i.url !== '/' && isActivePath(pathname, i.url));
  const section = mainNav.find((s) => s.items.some((i) => i === match))?.label;
  const trail: { title: string; url?: string }[] = [{ title: 'PayBridge Console', url: '/' }];
  if (!match) {
    if (pathname === '/') return [{ title: 'Overview' }];
    return trail;
  }
  if (section && section !== match.title) trail.push({ title: section });
  if (current && match.url) {
    // A detail page: the section links back to its list, the current item is the page.
    trail.push({ title: match.title, url: match.url }, { title: current });
    return trail;
  }
  trail.push({ title: match.title });
  return trail;
}
