import { FileQuestionIcon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/errors';

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
