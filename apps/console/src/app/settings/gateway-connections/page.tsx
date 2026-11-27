import { GatewayConnectionsScreen } from '@/components/gateways/gateway-connections-screen';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Gateway Connections' };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Gateway Connections"
        description="Your Organization's own accounts with PaymentGateways. Money goes straight to you; credentials are never shown again after saving."
      />
      <GatewayConnectionsScreen />
    </>
  );
}
