import type { ApiErrorBody } from '@/lib/api';

export function extractVeniceMessage(body: ApiErrorBody | undefined): string | undefined {
  const d = body?.error?.details;
  if (typeof d !== 'object' || d === null || !('veniceMessage' in d)) return undefined;
  const v = (d as Record<string, unknown>).veniceMessage;
  return typeof v === 'string' ? v : undefined;
}
