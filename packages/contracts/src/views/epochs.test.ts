import { describe, expect, it } from 'vitest';
import { EpochsIndex } from './epochs.js';

const entry = {
  epoch: '1t-final',
  label: '1º turno',
  elections: { president: '6257', governor: '6259' },
  manifest: { seq: 11387, sha: 'bc468c42011f50efcadb5536944d4f3313041b6260be28be0f0947bb561004ad' },
};

describe('EpochsIndex', () => {
  it('accepts a past round with a fixed manifest and a live one without', () => {
    const live = { ...entry, epoch: '2t-1', label: '2º turno', elections: { president: '6258', governor: '6260' }, manifest: null };
    expect(EpochsIndex.parse({ v: 1, epochs: [entry, live] }).epochs).toHaveLength(2);
  });

  it('rejects a duplicate epoch and an empty list', () => {
    expect(EpochsIndex.safeParse({ v: 1, epochs: [entry, entry] }).success).toBe(false);
    expect(EpochsIndex.safeParse({ v: 1, epochs: [] }).success).toBe(false);
  });
});
