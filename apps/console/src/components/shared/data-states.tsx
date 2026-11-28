import { Building2Icon, FileQuestionIcon, InboxIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/services/errors';

/** Shared empty / error states, so every data region fails the same way. */
export function NotFoundState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
      <FileQuestionIcon className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  // A Super Admin who has not chosen one Organization: not a failure, a prompt.
  if (isApiError(error) && error.code === 'ORGANIZATION_REQUIRED') {
    return (
      <div role="status" className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
        <Building2Icon className="size-8 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-medium">Choose an Organization</h2>
        <p className="text-sm text-muted-foreground">
          This screen works inside one Organization. Pick one in the Organization menu in the sidebar, then it will load.
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-destructive/30 p-10 text-center">
      <TriangleAlertIcon className="size-8 text-destructive" aria-hidden />
      <h2 className="text-base font-medium">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      {isApiError(error) && <p className="font-mono text-xs text-muted-foreground">{error.code}</p>}
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** A list with no rows yet: the same dashed panel the data tables use. */
export function EmptyListState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
      <InboxIcon className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-base font-medium">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
