import type { JSX, ReactNode } from 'react';
import type { ChatMessage } from '@/hooks/useChat';
import { AssistantBubble, CitationsSlot, MessageMeta, ThinkingBubble } from './primitives';

export interface AssistantMessageRowProps {
  message: ChatMessage;
  actions: ReactNode;
  isStreaming?: boolean;
  thinkingLabel?: string;
}

function getMessageText(contentJson: unknown): string {
  if (typeof contentJson === 'string') return contentJson;
  if (contentJson === null || contentJson === undefined) return '';
  try {
    return JSON.stringify(contentJson);
  } catch {
    return '';
  }
}

export function AssistantMessageRow({
  message,
  actions,
  isStreaming,
  thinkingLabel,
}: AssistantMessageRowProps): JSX.Element {
  const text = getMessageText(message.contentJson);
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
