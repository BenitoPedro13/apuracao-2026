import { z } from 'zod';

/**
 * Status of one result unit (architecture.md §7.2, invariant 6: missing ≠ zero ≠ failed).
 * A zero is a number inside `counting`/`final`; a missing value is never rendered as 0.
 */
export const ResultStatus = z.enum(['not_published', 'no_sections', 'counting', 'final', 'fetch_failed']);
export type ResultStatus = z.infer<typeof ResultStatus>;

/** Stable numeric codes for columnar views (MapView.status). Append only; never renumber. */
export const RESULT_STATUS_CODE = {
  not_published: 0,
  no_sections: 1,
  counting: 2,
  final: 3,
  fetch_failed: 4,
} as const satisfies Record<ResultStatus, number>;
