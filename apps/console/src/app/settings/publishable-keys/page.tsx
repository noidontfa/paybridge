import { PageHeader } from '@/components/layout/page-header';
import { PublishableKeysScreen } from '@/features/publishable-keys/components/publishable-keys-screen';

export const metadata = { title: 'Publishable Keys' };

export default function PublishableKeysPage() {
  return (
    <>
      <PageHeader
        title="Publishable Keys"
        description="Public keys your web pages use for the Embedded Checkout, each limited to the websites you allow."
      />
      <PublishableKeysScreen />
    </>
  );
}
