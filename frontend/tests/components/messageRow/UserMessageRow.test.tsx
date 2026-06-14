import { render, screen } from '@testing-library/react';
import type { Message } from 'story-editor-shared';
import { describe, expect, it } from 'vitest';
import { UserMessageRow } from '@/components/messageRow/UserMessageRow';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello world',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  };
}

describe('UserMessageRow', () => {
  it('renders user content in a right-aligned bubble', () => {
    render(<UserMessageRow message={makeMessage({ content: 'Hi there' })} />);
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('renders attachment preview when attachmentJson has selectionText', () => {
    render(
      <UserMessageRow
        message={makeMessage({
          attachmentJson: { selectionText: 'quoted text', chapterId: 'c-1' },
        })}
        chapterTitle="Chapter One"
      />,
    );
    expect(screen.getByText(/CHAPTER ONE/)).toBeInTheDocument();
    expect(screen.getByText('quoted text')).toBeInTheDocument();
  });

  it('skips attachment preview when selectionText empty', () => {
    render(
      <UserMessageRow
        message={makeMessage({
          attachmentJson: { selectionText: '', chapterId: 'c-1' },
        })}
      />,
    );
    expect(screen.queryByText(/FROM CH\./)).toBeNull();
  });

  it('falls back to "—" caption when chapterTitle missing but attachment has chapterId', () => {
    render(
      <UserMessageRow
        message={makeMessage({
          attachmentJson: { selectionText: 'q', chapterId: 'c-1' },
        })}
      />,
    );
    expect(screen.getByText(/—/)).toBeInTheDocument();
  });
});
