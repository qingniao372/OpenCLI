import { describe, expect, it } from 'vitest';
import { __test__ } from './ask.js';

describe('grok ask helpers', () => {
  it('normalizes boolean flags for explicit web routing', () => {
    expect(__test__.normalizeBooleanFlag(true)).toBe(true);
    expect(__test__.normalizeBooleanFlag('true')).toBe(true);
    expect(__test__.normalizeBooleanFlag('1')).toBe(true);
    expect(__test__.normalizeBooleanFlag('yes')).toBe(true);
    expect(__test__.normalizeBooleanFlag('on')).toBe(true);

    expect(__test__.normalizeBooleanFlag(false)).toBe(false);
    expect(__test__.normalizeBooleanFlag('false')).toBe(false);
    expect(__test__.normalizeBooleanFlag(undefined)).toBe(false);
  });

  it('ignores baseline bubbles and the echoed prompt when choosing the latest assistant candidate', () => {
    const candidate = __test__.pickLatestAssistantCandidate(
      ['older assistant answer', 'Prompt text', 'Assistant draft', 'Assistant final'],
      1,
      'Prompt text',
    );

    expect(candidate).toBe('Assistant final');
  });

  it('returns empty when only the echoed prompt appeared after send', () => {
    const candidate = __test__.pickLatestAssistantCandidate(
      ['older assistant answer', 'Prompt text'],
      1,
      'Prompt text',
    );

    expect(candidate).toBe('');
  });

  it('tracks stabilization by incrementing repeats and resetting on changes', () => {
    expect(__test__.updateStableState('', 0, 'First chunk')).toEqual({
      previousText: 'First chunk',
      stableCount: 0,
    });

    expect(__test__.updateStableState('First chunk', 0, 'First chunk')).toEqual({
      previousText: 'First chunk',
      stableCount: 1,
    });

    expect(__test__.updateStableState('First chunk', 1, 'Second chunk')).toEqual({
      previousText: 'Second chunk',
      stableCount: 0,
    });
  });
});
