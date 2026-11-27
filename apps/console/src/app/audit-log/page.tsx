import { Suspense } from 'react';
import { AuditScreen } from '@/components/audit/audit-screen';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Audit log' };

export default function Page() {
  return (
    <>
      <PageHeader title="Audit log" description="Every status transition, what triggered it and who made it." />
      <Suspense>
        <AuditScreen />
      </Suspense>
    </>
  );
}
