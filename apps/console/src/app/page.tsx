import { OverviewRoute } from '@/components/overview/overview-route';
import { PageHeader } from '@/components/page-header';
import { parseRange } from '@/lib/overview-range';

export const metadata = { title: 'Overview' };

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const { range } = await searchParams;
  return (
    <>
      <PageHeader title="Overview" description="Volume, success rate and open Reviews at a glance." />
      <OverviewRoute initialRange={parseRange(range)} />
    </>
  );
}
