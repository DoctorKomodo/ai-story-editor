import { describe, expect, it, vi } from 'vitest';
import { triggerDownload } from '@/hooks/useBackup';

describe('triggerDownload', () => {
  it('creates an object URL and clicks an anchor with the filename', () => {
    const click = vi.fn();
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    triggerDownload(new Blob(['{}']), 'inkwell-backup.json');
    expect(createURL).toHaveBeenCalled();
    expect(anchor.download).toBe('inkwell-backup.json');
    expect(click).toHaveBeenCalled();
  });
});
