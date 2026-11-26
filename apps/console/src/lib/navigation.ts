import {
  BookOpenIcon,
  CreditCardIcon,
  FileClockIcon,
  BuildingIcon,
  GaugeIcon,
  GlobeIcon,
  ShieldCheckIcon,
  KeyRoundIcon,
  LandmarkIcon,
  MailPlusIcon,
  PlugIcon,
  OctagonAlertIcon,
  ReceiptIcon,
  SendIcon,
  SettingsIcon,
  TagIcon,
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
  /** The Permission needed to see the item; absent means everyone. */
  permission?: string;
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
  {
    label: 'Checkout',
    items: [{ title: 'Pricing Plans', url: '/pricing-plans', icon: TagIcon, permission: 'pricing:view' }],
  },
];

/** The Super Admin's Platform area; shown only with the Permission to manage Organizations. */
export const platformNav: NavSection = {
  label: 'Platform',
  items: [
    { title: 'Organizations', url: '/platform/organizations', icon: BuildingIcon },
    { title: 'Super Admins', url: '/platform/super-admins', icon: ShieldCheckIcon },
  ],
};

export const secondaryNav: NavItem[] = [
  { title: 'Users', url: '/settings/users', icon: UsersIcon, permission: 'users:manage' },
  { title: 'Invitations', url: '/settings/invitations', icon: MailPlusIcon, permission: 'users:manage' },
  { title: 'Settings', url: '/settings', icon: SettingsIcon },
  { title: 'API Keys', url: '/settings/api-keys', icon: KeyRoundIcon, permission: 'api-keys:manage' },
  {
    title: 'Publishable Keys',
    url: '/settings/publishable-keys',
    icon: GlobeIcon,
    permission: 'publishable-keys:manage',
  },
  {
    title: 'Gateway Connections',
    url: '/settings/gateway-connections',
    icon: PlugIcon,
    permission: 'gateway-connections:manage',
  },
  {
    title: 'Webhook Endpoints',
    url: '/settings/webhook-endpoints',
    icon: SendIcon,
    permission: 'webhook-endpoints:manage',
  },
  { title: 'Docs', url: '/docs', icon: BookOpenIcon },
];

export function isActivePath(pathname: string, url: string): boolean {
  if (url === '/') return pathname === '/';
  return pathname === url || pathname.startsWith(`${url}/`);
}

/** Breadcrumb trail for a pathname, derived from the navigation. */
export function breadcrumbFor(pathname: string, current?: string): { title: string; url?: string }[] {
  const sections = [...mainNav, platformNav];
  const all = [...sections.flatMap((s) => s.items), ...secondaryNav];
  const match = all.find((i) => i.url && i.url !== '/' && isActivePath(pathname, i.url));
  const section = sections.find((s) => s.items.some((i) => i === match))?.label;
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
