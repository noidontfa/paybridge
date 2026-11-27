import { FlaskConicalIcon } from 'lucide-react';

/** Shown on every page while the Console runs on mock data, so fake Payments are never mistaken for real ones. */
export function MockBanner() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-center text-xs font-medium text-amber-800 dark:text-amber-300"
    >
      <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden />
      Mock mode: you are looking at seeded sample data, not real Payments.
    </div>
  );
}
