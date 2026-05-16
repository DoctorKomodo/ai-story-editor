import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsModalStore } from '@/store/settingsModal';

describe('useSettingsModalStore', () => {
  beforeEach(() => {
    useSettingsModalStore.getState().close();
  });

  it('starts closed with no initial tab', () => {
    const s = useSettingsModalStore.getState();
    expect(s.open).toBe(false);
    expect(s.initialTab).toBeUndefined();
  });

  it('openWith() with no tab → open=true, initialTab=undefined', () => {
    useSettingsModalStore.getState().openWith();
    const s = useSettingsModalStore.getState();
    expect(s.open).toBe(true);
    expect(s.initialTab).toBeUndefined();
  });

  it('openWith("models") → open=true, initialTab="models"', () => {
    useSettingsModalStore.getState().openWith('models');
    const s = useSettingsModalStore.getState();
    expect(s.open).toBe(true);
    expect(s.initialTab).toBe('models');
  });

  it('openWith("venice") then close() → resets both fields', () => {
    useSettingsModalStore.getState().openWith('venice');
    useSettingsModalStore.getState().close();
    const s = useSettingsModalStore.getState();
    expect(s.open).toBe(false);
    expect(s.initialTab).toBeUndefined();
  });

  it('openWith("models") then openWith("venice") → tab switches', () => {
    useSettingsModalStore.getState().openWith('models');
    useSettingsModalStore.getState().openWith('venice');
    expect(useSettingsModalStore.getState().initialTab).toBe('venice');
  });
});
