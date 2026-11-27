import { Suspense } from 'react';
import { ExceptionsScreen } from '@/components/exceptions/exceptions-screen';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Exceptions' };

export default function Page() {
  return (
    <>
      <PageHeader title="Exceptions" description="Reviews that need an Operator, longest-waiting first." />
      <Suspense>
        <ExceptionsScreen />
      </Suspense>
    </>
  );
}
