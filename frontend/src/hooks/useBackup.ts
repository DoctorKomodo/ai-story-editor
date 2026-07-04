import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  ImportPlanRequest,
  ImportPlanResponse,
  ImportRequest,
  ImportResult,
} from 'story-editor-shared';
import { importPlanResponseSchema, importResultSchema } from 'story-editor-shared';
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

/**
 * Preflight plan: matches the file's `{ id, snapshotUpdatedAt }` stories
 * against the caller's live stories without mutating anything. Called once
 * per file selection (see `SettingsDataTab`), never per keystroke/render —
 * it shares its rate-limit bucket with `useImportBackup`.
 */
export function useImportPlan() {
  return useMutation<ImportPlanResponse, Error, ImportPlanRequest>({
    mutationFn: async (body) => {
      const raw = await api<unknown>('/users/me/import/plan', {
        method: 'POST',
        body,
      });
      return importPlanResponseSchema.parse(raw);
    },
  });
}

export function useImportBackup() {
  const qc = useQueryClient();
  return useMutation<ImportResult, Error, ImportRequest>({
    mutationFn: async ({ file, resolutions }) => {
      const raw = await api<unknown>('/users/me/import', {
        method: 'POST',
        body: { file, resolutions },
      });
      return importResultSchema.parse(raw);
    },
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}
