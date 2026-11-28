import { CallbackDetailScreen } from '@/features/callbacks/components/callback-detail-screen';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Callback' };

export default async function CallbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Callback" description="One notification from a PaymentGateway, as received." current={id} />
      <CallbackDetailScreen id={id} />
    </>
  );
}
