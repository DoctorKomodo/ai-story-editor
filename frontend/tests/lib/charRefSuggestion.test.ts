import { describe, expect, it } from 'vitest';
import {
  __getCharRefSuggestionProvider,
  filterCharacters,
  setCharRefSuggestionProvider,
} from '@/lib/charRefSuggestion';

describe('filterCharacters', () => {
  const cast = [
    { id: '1', name: 'Elena Marsh', role: 'Protagonist' },
    { id: '2', name: 'Eli Bracken', role: 'Antagonist' },
    { id: '3', name: 'Marcus Stone', role: null },
    { id: '4', name: 'Ada Holloway', role: null },
    { id: '5', name: 'Adam West', role: null },
    { id: '6', name: 'Bella Reyes', role: null },
    { id: '7', name: 'Connor Hale', role: null },
    { id: '8', name: 'Diana Ortiz', role: null },
    { id: '9', name: 'Esther Wilde', role: null },
  ];

  it('returns all items (capped to 8) on empty query', () => {
    expect(filterCharacters(cast, '')).toHaveLength(8);
  });

  it('prefix matches rank above substring matches', () => {
    const out = filterCharacters(cast, 'el');
    expect(out[0]?.name).toBe('Elena Marsh');
    expect(out[1]?.name).toBe('Eli Bracken');
    const bella = out.find((c) => c.id === '6');
    expect(bella).toBeDefined();
    if (bella) {
      const bellaIdx = out.indexOf(bella);
      const elenaIdx = out.findIndex((c) => c.id === '1');
      expect(bellaIdx).toBeGreaterThan(elenaIdx);
    }
  });

  it('case-insensitive', () => {
    expect(filterCharacters(cast, 'ELE').map((c) => c.id)).toEqual(['1']);
    expect(filterCharacters(cast, 'elE').map((c) => c.id)).toEqual(['1']);
  });

  it('returns the empty list when nothing matches', () => {
    expect(filterCharacters(cast, 'zzz')).toHaveLength(0);
  });
});

describe('character provider ref', () => {
  it('default returns []', () => {
    setCharRefSuggestionProvider(null);
    expect(__getCharRefSuggestionProvider()()).toEqual([]);
  });

  it('setCharRefSuggestionProvider installs a getter', () => {
    setCharRefSuggestionProvider(() => [{ id: 'x', name: 'X', role: null }]);
    expect(__getCharRefSuggestionProvider()()[0]?.name).toBe('X');
    setCharRefSuggestionProvider(null);
  });
});
