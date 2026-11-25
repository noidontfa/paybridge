import { PageHeader } from '@/components/page-header';

/** A page that exists in the navigation but is built by a later ticket. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="px-4 pb-4">
        <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
          This screen is coming soon.
        </div>
      </div>
    </>
  );
}
