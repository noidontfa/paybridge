import { EventDetailScreen } from '@/components/events/event-detail-screen';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Payment Event' };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Payment Event" description="One event from the outbox, with its payload." current={id} />
      <EventDetailScreen id={id} />
    </>
  );
}
