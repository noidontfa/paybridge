import { PageHeader } from '@/components/page-header';
import { WebhookEndpointsScreen } from '@/components/webhooks/webhook-endpoints-screen';

export const metadata = { title: 'Webhook Endpoints' };

export default function WebhookEndpointsPage() {
  return (
    <>
      <PageHeader
        title="Webhook Endpoints"
        description="URLs of your own systems that receive every Payment Event of this Organization, signed with each endpoint's secret."
      />
      <WebhookEndpointsScreen />
    </>
  );
}
