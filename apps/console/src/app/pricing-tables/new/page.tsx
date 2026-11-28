import { PageHeader } from '@/components/layout/page-header';
import { NewPricingTableScreen } from '@/features/pricing-tables/components/pricing-table-editor';

export const metadata = { title: 'New Pricing Table' };

export default function NewPricingTablePage() {
  return (
    <>
      <PageHeader title="New Pricing Table" description="Once saved, copy its snippet into your website." current="New" />
      <NewPricingTableScreen />
    </>
  );
}
