import { GatewaysScreen } from '@/features/gateways/components/gateways-screen';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Gateways' };

export default function Page() {
  return (
    <>
      <PageHeader title="Gateways" description="The PaymentGateways this deployment serves, as the API reports them." />
      <GatewaysScreen />
    </>
  );
}
