import type { JSX } from 'react';

export function ChatEmptyState(): JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-4 text-center" data-testid="chat-empty">
      <p className="text-[13px] text-ink-3 font-sans">Start a conversation</p>
    </div>
  );
}
