import { Suspense } from 'react';
import { EventsScreen } from '@/features/payment-events/components/events-screen';
import { PageHeader } from '@/components/layout/page-header';

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
