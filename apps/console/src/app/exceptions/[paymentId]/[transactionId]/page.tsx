import { PageHeader } from '@/components/layout/page-header';
import { ReviewPage } from '@/features/reviews/components/review-page';

export const metadata = { title: 'Review' };

export default async function Page({ params }: { params: Promise<{ paymentId: string; transactionId: string }> }) {
  const { paymentId, transactionId } = await params;
  return (
    <>
      <PageHeader title="Review" description="The Payment, the PaymentTransaction in Review and its status history." current={transactionId} />
      <ReviewPage paymentId={paymentId} transactionId={transactionId} />
    </>
  );
}
