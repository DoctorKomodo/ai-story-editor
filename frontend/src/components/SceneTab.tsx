/** [SC17] Thin wrapper over the shared [ChatSceneTab] shell — kind='scene'. */
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { JSX } from 'react';
import { ChatSceneTab } from '@/components/ChatSceneTab';

export interface SceneTabProps {
  draftId: string | null;
  editor: TiptapEditor | null;
}

export function SceneTab({ draftId, editor }: SceneTabProps): JSX.Element {
  return <ChatSceneTab kind="scene" draftId={draftId} editor={editor} />;
}
