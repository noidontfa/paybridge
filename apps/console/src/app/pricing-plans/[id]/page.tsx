import { PageHeader } from '@/components/layout/page-header';
import { PricingPlanEditorScreen } from '@/features/pricing-plans/components/pricing-plan-editor';

export const metadata = { title: 'Pricing Plan' };

export default async function PricingPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        title="Pricing Plan"
        description="Changes apply to Payments created from now on; Payments already created keep their Amount."
        current="Edit"
      />
      <PricingPlanEditorScreen id={id} />
    </>
  );
}
