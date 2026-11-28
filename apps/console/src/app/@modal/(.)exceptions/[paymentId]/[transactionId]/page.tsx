import { ReviewModal } from '@/features/reviews/components/review-modal';

export default async function Page({ params }: { params: Promise<{ paymentId: string; transactionId: string }> }) {
  const { paymentId, transactionId } = await params;
  return <ReviewModal paymentId={paymentId} transactionId={transactionId} />;
}
