import { Suspense } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { WebhookDeliveriesScreen } from '@/components/webhook-deliveries/webhook-deliveries-screen';

export const metadata = { title: 'Webhook deliveries' };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Webhook deliveries"
        description="Each Payment Event PayBridge sent to your Webhook Endpoints, with every attempt. Not Callbacks, which gateways send to PayBridge."
      />
      <Suspense>
        <WebhookDeliveriesScreen />
      </Suspense>
    </>
  );
}
