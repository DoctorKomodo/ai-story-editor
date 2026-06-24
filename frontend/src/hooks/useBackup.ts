import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ImportFile, ImportResult } from 'story-editor-shared';
import { api, fetchExportBlob } from '@/lib/api';

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useExportBackup(): { download: () => Promise<void>; isPending: boolean } {
  const [isPending, setPending] = useState(false);
  async function download(): Promise<void> {
    setPending(true);
    try {
      const { blob, filename } = await fetchExportBlob();
      triggerDownload(blob, filename);
    } finally {
      setPending(false);
    }
  }
  return { download, isPending };
}

export function useImportBackup() {
  const qc = useQueryClient();
  return useMutation<ImportResult, Error, ImportFile>({
    mutationFn: (file) => api<ImportResult>('/users/me/import', { method: 'POST', body: file }),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}
