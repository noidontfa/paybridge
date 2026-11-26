import { PageHeader } from '@/components/page-header';
import { PricingPlanEditorScreen } from '@/components/pricing-plans/pricing-plan-editor';

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
