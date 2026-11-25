import { ReviewModal } from '@/components/exceptions/review-modal';

export default async function Page({ params }: { params: Promise<{ paymentId: string; transactionId: string }> }) {
  const { paymentId, transactionId } = await params;
  return <ReviewModal paymentId={paymentId} transactionId={transactionId} />;
}
