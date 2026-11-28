import { PageHeader } from '@/components/page-header';
import { PricingPlansScreen } from '@/components/pricing-plans/pricing-plans-screen';

export const metadata = { title: 'Pricing Plans' };

export default function PricingPlansPage() {
  return (
    <>
      <PageHeader
        title="Pricing Plans"
        description="What this Organization sells: a name, a price in VND, the features it includes and how Customers may pay."
      />
      <PricingPlansScreen />
    </>
  );
}
