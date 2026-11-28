import { GatewayDetailScreen } from '@/features/gateways/components/gateway-detail-screen';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Gateway' };

export default async function GatewayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Gateway" description="Registration, mode and the health of its Callbacks." current={id} />
      <GatewayDetailScreen id={id} />
    </>
  );
}
