// Dashboard landing surface: the Your-Stories browser rendered embedded (no
// backdrop, no Close — a permanent landing surface). All picker/create/navigate
// behavior lives in StoryBrowser.
import type { JSX } from 'react';
import { StoryBrowser } from '@/components/StoryBrowser';

export function DashboardPage(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg p-8">
      <StoryBrowser embedded open onClose={() => undefined} activeStoryId={null} />
    </main>
  );
}
