import type { JSX } from 'react';
import { useState } from 'react';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { StoryCard } from '@/components/StoryCard';
import { StoryModal } from '@/components/StoryModal';
import { useStoriesQuery } from '@/hooks/useStories';

export function DashboardPage(): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);
  const { data: stories, isLoading, isError, error } = useStoriesQuery();

  return (
    <main className="min-h-screen p-8 bg-neutral-50 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold">Your Stories</h1>
        <div className="flex items-center gap-2">
          <DarkModeToggle />
          <button
            type="button"
            onClick={() => {
              setModalOpen(true);
            }}
            className="bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700 transition-colors"
          >
            New Story
          </button>
        </div>
      </header>

      {isLoading ? (
        <div role="status" aria-live="polite" className="text-neutral-600 dark:text-neutral-300">
          Loading stories…
        </div>
      ) : isError ? (
        <p role="alert" className="text-red-600">
          {error instanceof Error ? error.message : 'Failed to load stories.'}
        </p>
      ) : stories && stories.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border border-dashed border-neutral-300 rounded-md p-8 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-lg text-neutral-700 dark:text-neutral-200">No stories yet</p>
          <button
            type="button"
            onClick={() => {
              setModalOpen(true);
            }}
            className="bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700 transition-colors"
          >
            Create your first story
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(stories ?? []).map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>
      )}

      <StoryModal
        mode="create"
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
        }}
      />
    </main>
  );
}
