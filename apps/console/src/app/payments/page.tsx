import { Suspense } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { PaymentsScreen } from '@/components/payments/payments-screen';

export const metadata = { title: 'Payments' };

export default function Page() {
  return (
    <>
      <PageHeader title="Payments" description="Every Payment, filterable by status and gateway." />
      <Suspense>
        <PaymentsScreen />
      </Suspense>
    </>
  );
}
