'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { breadcrumbFor } from '@/components/layout/navigation';

/** `current` names the item a detail page shows (an id), added after the section crumb. */
export function PageHeader({ title, description, current }: { title: string; description?: string; current?: string }) {
  const trail = breadcrumbFor(usePathname(), current);
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            {trail.map((crumb, index) => {
              const last = index === trail.length - 1;
              return (
                <Fragment key={`${crumb.title}-${index}`}>
                  <BreadcrumbItem className={last ? undefined : 'hidden md:inline-flex'}>
                    {last ? (
                      <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                    ) : crumb.url ? (
                      <BreadcrumbLink render={<Link href={crumb.url} />}>{crumb.title}</BreadcrumbLink>
                    ) : (
                      <span>{crumb.title}</span>
                    )}
                  </BreadcrumbItem>
                  {!last && <BreadcrumbSeparator className="hidden md:block" />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </header>
      <div className="px-4 pb-4">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </>
  );
}
