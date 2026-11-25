import { z } from 'zod';
import { OVERVIEW_RANGES } from '../../application/use-cases/console/get-overview.js';

export const overviewQuerySchema = z.object({
  range: z.enum(OVERVIEW_RANGES),
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
