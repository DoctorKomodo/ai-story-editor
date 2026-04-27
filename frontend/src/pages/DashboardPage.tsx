// [F58] Dashboard renders the F30 <StoryPicker> as a permanent embedded
// surface. The card-grid + dashed-border empty-state from F5 are removed;
// "No stories yet" copy and the "New story" CTA live inside the picker.
import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StoryModal } from '@/components/StoryModal';
import { StoryPicker } from '@/components/StoryPicker';

export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const [storyModalOpen, setStoryModalOpen] = useState(false);

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg p-8">
      <StoryPicker
        embedded
        open
        onClose={() => undefined}
        activeStoryId={null}
        onSelectStory={(id) => {
          navigate(`/stories/${id}`);
        }}
        onCreateStory={() => {
          setStoryModalOpen(true);
        }}
      />
      <StoryModal
        mode="create"
        open={storyModalOpen}
        onClose={() => {
          setStoryModalOpen(false);
        }}
      />
    </main>
  );
}
