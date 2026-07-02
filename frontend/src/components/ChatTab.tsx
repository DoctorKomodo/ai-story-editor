import type { Editor as TiptapEditor } from '@tiptap/core';
import type { JSX } from 'react';
import { ChatSceneTab } from '@/components/ChatSceneTab';

export interface ChatTabProps {
  chapterId: string | null;
  editor: TiptapEditor | null;
}

/** Thin wrapper over the shared [ChatSceneTab] shell — kind='ask'. */
export function ChatTab({ chapterId, editor }: ChatTabProps): JSX.Element {
  return <ChatSceneTab kind="ask" chapterId={chapterId} editor={editor} />;
}
