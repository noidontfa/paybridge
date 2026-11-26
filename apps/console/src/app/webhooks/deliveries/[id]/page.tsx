import { PageHeader } from '@/components/page-header';
import { WebhookDeliveryDetailScreen } from '@/components/webhook-deliveries/webhook-delivery-detail-screen';

export const metadata = { title: 'Webhook delivery' };

export default async function WebhookDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Webhook delivery" description="One Payment Event to one Webhook Endpoint, with every attempt." current={id} />
      <WebhookDeliveryDetailScreen id={id} />
    </>
  );
}
