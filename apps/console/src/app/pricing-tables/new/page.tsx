import { PageHeader } from '@/components/page-header';
import { NewPricingTableScreen } from '@/components/pricing-tables/pricing-table-editor';

export const metadata = { title: 'New Pricing Table' };

export default function NewPricingTablePage() {
  return (
    <>
      <PageHeader title="New Pricing Table" description="Once saved, copy its snippet into your website." current="New" />
      <NewPricingTableScreen />
    </>
  );
}
