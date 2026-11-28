import { PageHeader } from '@/components/layout/page-header';
import { PricingTablesScreen } from '@/features/pricing-tables/components/pricing-tables-screen';

export const metadata = { title: 'Pricing Tables' };

export default function PricingTablesPage() {
  return (
    <>
      <PageHeader
        title="Pricing Tables"
        description="One to three Pricing Plans shown side by side on your website, with a simple look and a snippet to embed them."
      />
      <PricingTablesScreen />
    </>
  );
}
