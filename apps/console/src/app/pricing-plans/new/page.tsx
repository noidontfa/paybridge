import { PageHeader } from '@/components/layout/page-header';
import { NewPricingPlanScreen } from '@/components/pricing-plans/pricing-plan-editor';

export const metadata = { title: 'New Pricing Plan' };

export default function NewPricingPlanPage() {
  return (
    <>
      <PageHeader title="New Pricing Plan" description="Nothing can buy it until it is shown in a Pricing Table." current="New" />
      <NewPricingPlanScreen />
    </>
  );
}
