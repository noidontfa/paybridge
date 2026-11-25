import { Badge } from '@/components/ui/badge';
import { TimeText } from '@/components/time-text';
import type { PaymentEvent } from '@/lib/api/schemas';

/** The Payment Events Core emitted for this Payment, oldest first. */
export function PaymentEvents({ events }: { events: PaymentEvent[] }) {
  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-3">
      <h2 id="events-heading" className="text-base font-semibold">
        Payment Events
      </h2>
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No Payment Events yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
              <span className="font-mono">{event.type}</span>
              <TimeText iso={event.createdAt} />
              <Badge variant="outline">{event.publishedAt ? 'Published' : 'Unpublished'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
