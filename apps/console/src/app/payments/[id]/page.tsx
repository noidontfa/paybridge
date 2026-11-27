import { PageHeader } from '@/components/layout/page-header';
import { PaymentDetailScreen } from '@/features/payments/components/payment-detail-screen';

export const metadata = { title: 'Payment' };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Payment" description="The full story of one Payment and its PaymentTransactions." current={id} />
      <PaymentDetailScreen id={id} />
    </>
  );
}
