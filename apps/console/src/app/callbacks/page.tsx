import { Suspense } from 'react';
import { CallbacksScreen } from '@/features/callbacks/components/callbacks-screen';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Callbacks' };

export default function Page() {
  return (
    <>
      <PageHeader title="Callbacks" description="Webhook inbox. What each PaymentGateway sent to PayBridge. Not Payment Events, which Core emits." />
      <Suspense>
        <CallbacksScreen />
      </Suspense>
    </>
  );
}
