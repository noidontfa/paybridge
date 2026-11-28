'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { OpenReviewsBadge } from '@/features/reviews/components/open-reviews-badge';
import { isActivePath, type NavSection } from '@/components/layout/navigation';
import { useCanFn } from '@/features/auth/hooks/use-operator';

export function NavMain({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const can = useCanFn();
  return (
    <>
      {sections.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permission || can(item.permission)),
      })).filter((section) => section.items.length > 0).map((section, index) => {
        const labelId = section.label ? `nav-group-${section.label.toLowerCase()}` : undefined;
        return (
          <SidebarGroup
            key={section.label ?? `section-${index}`}
            role="group"
            aria-labelledby={labelId}
          >
            {section.label && <SidebarGroupLabel id={labelId}>{section.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {section.items.map((item) => {
                const Icon = item.icon;
                if (!item.url) {
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton disabled>
                        <Icon />
                        <span>{item.title}</span>
                        {item.badge && (
                          <span className="ml-auto rounded-md border px-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                            {item.badge}
                          </span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }
                const active = isActivePath(pathname, item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      render={<Link href={item.url} aria-current={active ? 'page' : undefined} />}
                    >
                      <Icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {item.liveBadge === 'openReviews' && <OpenReviewsBadge />}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        );
      })}
    </>
  );
}
