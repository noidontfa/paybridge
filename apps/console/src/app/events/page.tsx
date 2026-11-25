import { Suspense } from 'react';
import { EventsScreen } from '@/components/events/events-screen';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Events' };

export default function Page() {
  return (
    <>
      <PageHeader title="Events" description="Outbox. Payment Events Core emitted, and whether the relay has published them." />
      <Suspense>
        <EventsScreen />
      </Suspense>
    </>
  );
}
