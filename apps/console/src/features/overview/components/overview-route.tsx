'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { overviewHref, type OverviewRange } from '@/features/overview/utils/overview-range';
import { OverviewScreen } from './overview-screen';

/** Keeps the range in the URL: the server reads it on load, a change replaces the URL. */
export function OverviewRoute({ initialRange }: { initialRange: OverviewRange }) {
  const router = useRouter();
  const [range, setRange] = useState(initialRange);

  return (
    <OverviewScreen
      range={range}
      onRangeChange={(next) => {
        setRange(next);
        router.replace(overviewHref(next), { scroll: false });
      }}
    />
  );
}
