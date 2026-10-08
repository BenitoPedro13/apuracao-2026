import { z } from 'zod';
import { ElectionCode } from '../observation.js';

// Shared pieces of the published views (TASK-projector-and-views.md §2.1, §2.4).
// Views carry no epoch/seq: the same state renders the same bytes, so an unchanged view
// keeps its content-addressed URL. Only the Manifest says which seq a view belongs to.

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const IsoInstant = z.iso.datetime({ offset: true });

/** A TSE percentage exactly as published ("47,03"). Never re-rounded (ADR-12). */
export const TsePct = z.object({ raw: z.string().regex(/^\d+(,\d+)?$/) });
export type TsePct = z.infer<typeof TsePct>;

/** Election roles a projector runs for. */
export const Office = z.enum(['president', 'governor']);
export type Office = z.infer<typeof Office>;

export const Elections = z.object({ president: ElectionCode, governor: ElectionCode });
export type Elections = z.infer<typeof Elections>;

/**
 * The signed TSE files (`.jws` sha256) every number in a view comes from, sorted. Views
 * over thousands of files (map, municipality tables) carry them per row or as a digest
 * instead, since 5,571 hashes would outweigh the view.
 */
export const Sources = z.array(Sha256);

/** sha256 of the sorted source hashes joined by "\n". */
export const SourcesDigest = Sha256;

/** The TSE header fields of the file a unit came from. */
export const TseStamp = z.object({
  idg: z.string(),
  generatedAt: IsoInstant,
  /** null: nothing totalized yet (the file has `dt`/`ht` = ""). */
  totalizedAt: IsoInstant.nullable(),
});
export type TseStamp = z.infer<typeof TseStamp>;
