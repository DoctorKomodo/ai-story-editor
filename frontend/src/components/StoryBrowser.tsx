// Shared Your-Stories surface: the StoryPicker plus the create StoryModal and
// the select/create → navigate wiring. Rendered embedded on the dashboard
// landing surface and as a dismissible modal in the editor. Keeping the create
// flow here (not per-page) is why both surfaces stay in sync.
import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StoryModal } from '@/components/StoryModal';
import { StoryPicker } from '@/components/StoryPicker';

export interface StoryBrowserProps {
  open: boolean;
  onClose: () => void;
  activeStoryId: string | null;
  embedded?: boolean;
}

export function StoryBrowser({
  open,
  onClose,
  activeStoryId,
  embedded = false,
}: StoryBrowserProps): JSX.Element {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <StoryPicker
        open={open}
        onClose={onClose}
        activeStoryId={activeStoryId}
        embedded={embedded}
        onSelectStory={(id) => {
          navigate(`/stories/${id}`);
        }}
        onStoryDeleted={(id) => {
          // [story-editor-0wz] The [story-editor-f1t] dead-end: if the
          // deleted story is the one currently open in the editor, leave for
          // the library before EditorPage's storyQuery 404s.
          if (id === activeStoryId) {
            navigate('/');
          }
        }}
        onCreateStory={() => {
          onClose();
          setCreateOpen(true);
        }}
      />
      <StoryModal
        mode="create"
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        onCreated={(created) => {
          navigate(`/stories/${created.id}`);
        }}
      />
    </>
  );
}
