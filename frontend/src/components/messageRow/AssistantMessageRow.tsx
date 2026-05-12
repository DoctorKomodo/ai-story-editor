import type { JSX, ReactNode } from 'react';
import type { Message } from 'story-editor-shared';
import { AssistantBubble, CitationsSlot, MessageMeta, ThinkingBubble } from './primitives';

export interface AssistantMessageRowProps {
  message: Message;
  actions: ReactNode;
  isStreaming?: boolean;
  thinkingLabel?: string;
}

export function AssistantMessageRow({
  message,
  actions,
  isStreaming,
  thinkingLabel,
}: AssistantMessageRowProps): JSX.Element {
  const text = message.content;
  const showThinking = isStreaming === true && text.length === 0;

  return (
    <li
      className="flex flex-col"
      data-message-id={message.id}
      data-role="assistant"
      data-testid={`assistant-${message.id}`}
    >
      {showThinking ? (
        <ThinkingBubble {...(thinkingLabel !== undefined ? { label: thinkingLabel } : {})} />
      ) : (
        <AssistantBubble>{text}</AssistantBubble>
      )}
      {actions}
      <MessageMeta model={message.model} tokens={message.tokens} latencyMs={message.latencyMs} />
      <CitationsSlot citations={message.citationsJson} messageId={message.id} />
    </li>
  );
}
