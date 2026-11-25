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
import { OpenReviewsBadge } from '@/components/open-reviews-badge';
import { isActivePath, type NavSection } from '@/lib/navigation';

export function NavMain({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  return (
    <>
      {sections.map((section, index) => {
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
