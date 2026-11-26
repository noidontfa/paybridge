import { PageHeader } from '@/components/page-header';
import { PricingTableEditorScreen } from '@/components/pricing-tables/pricing-table-editor';

export const metadata = { title: 'Pricing Table' };

export default async function PricingTablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        title="Pricing Table"
        description="Changes show on every page that embeds it, without pasting the snippet again."
        current="Edit"
      />
      <PricingTableEditorScreen id={id} />
    </>
  );
}
