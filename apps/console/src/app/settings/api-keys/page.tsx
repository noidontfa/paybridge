import { ApiKeysScreen } from '@/components/api-keys/api-keys-screen';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'API Keys' };

export default function ApiKeysPage() {
  return (
    <>
      <PageHeader
        title="API Keys"
        description="Keys your own system uses to call the PayBridge payments API for this Organization."
      />
      <ApiKeysScreen />
    </>
  );
}
