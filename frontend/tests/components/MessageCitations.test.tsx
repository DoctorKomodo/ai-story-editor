import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MessageCitations } from '@/components/MessageCitations';
import type { Citation } from '@/hooks/useChat';

const SAMPLE: Citation[] = [
  {
    title: 'Example Domain',
    url: 'https://example.com/a',
    snippet: 'A short preview of the page.',
    publishedAt: '2026-04-01',
  },
  {
    title: 'Another Source',
    url: 'https://example.org/b',
    snippet: 'Second snippet without a date.',
    publishedAt: null,
  },
  {
    title: 'Third',
    url: 'https://third.example/c',
    snippet: 'Third snippet.',
    publishedAt: '2026-04-02T10:00:00Z',
  },
];

describe('MessageCitations (F50)', () => {
  it('renders nothing when citations is null', () => {
    const { container } = render(<MessageCitations citations={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when citations is an empty array', () => {
    const { container } = render(<MessageCitations citations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a Sources (N) pill when citations are present', () => {
    render(<MessageCitations citations={SAMPLE} />);
    expect(screen.getByText('Sources (3)')).toBeInTheDocument();
  });

  it('expanding the disclosure reveals all items', async () => {
    render(<MessageCitations citations={SAMPLE} />);
    const summary = screen.getByText('Sources (3)');
    await userEvent.click(summary);
    const items = screen.getAllByTestId('message-citation-item');
    expect(items).toHaveLength(3);
  });

  it('each link has target="_blank" and rel="noopener noreferrer"', () => {
    render(<MessageCitations citations={SAMPLE} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('renders the snippet as plain text (no HTML execution)', () => {
    const malicious: Citation[] = [
      {
        title: 'Title',
        url: 'https://example.com',
        snippet: '<script>alert(1)</script>Hello',
        publishedAt: null,
      },
    ];
    render(<MessageCitations citations={malicious} />);
    const snippet = screen.getByTestId('message-citation-snippet');
    expect(snippet.textContent).toBe('<script>alert(1)</script>Hello');
    expect(snippet.innerHTML).not.toContain('<script>');
    expect(snippet.querySelector('script')).toBeNull();
  });

  it('renders publishedAt only when present', () => {
    render(<MessageCitations citations={SAMPLE} />);
    const items = screen.getAllByTestId('message-citation-item');
    expect(within(items[0] as HTMLElement).getByText('2026-04-01')).toBeInTheDocument();
    expect(within(items[2] as HTMLElement).getByText('2026-04-02')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).queryByText(/2026-/)).toBeNull();
  });

  it('Sources count matches citations.length', () => {
    render(<MessageCitations citations={[SAMPLE[0]] as Citation[]} />);
    expect(screen.getByText('Sources (1)')).toBeInTheDocument();
  });
});
