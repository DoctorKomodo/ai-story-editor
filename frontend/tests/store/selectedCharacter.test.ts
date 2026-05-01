import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';

describe('useSelectedCharacterStore', () => {
  beforeEach(() => {
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
  });

  it('initial state is null', () => {
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBeNull();
  });

  it('setSelectedCharacterId(id) updates the store', () => {
    useSelectedCharacterStore.getState().setSelectedCharacterId('abc');
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBe('abc');
  });

  it('setSelectedCharacterId(null) clears the store', () => {
    useSelectedCharacterStore.setState({ selectedCharacterId: 'abc' });
    useSelectedCharacterStore.getState().setSelectedCharacterId(null);
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBeNull();
  });
});
