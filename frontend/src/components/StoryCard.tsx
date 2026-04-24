import { Link } from 'react-router-dom';
import { formatRelative } from '@/lib/time';
import type { StoryListItem } from '@/hooks/useStories';

export interface StoryCardProps {
  story: StoryListItem;
  /** Override the "now" instant — for test determinism. */
  now?: Date;
}

function formatWordCount(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'word' : 'words'}`;
}

function formatChapterCount(n: number): string {
  return `${String(n)} ${n === 1 ? 'chapter' : 'chapters'}`;
}

export function StoryCard({ story, now }: StoryCardProps): JSX.Element {
  return (
    <Link
      to={`/stories/${story.id}`}
      className="flex flex-col gap-2 border border-neutral-200 rounded-md p-4 bg-white hover:border-neutral-400 hover:shadow-sm transition-colors"
    >
      <h3 className="text-lg font-semibold text-neutral-900">{story.title}</h3>
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {story.genre ?? 'No genre'}
      </p>
      {story.synopsis ? (
        <p className="text-sm text-neutral-700 line-clamp-3">{story.synopsis}</p>
      ) : (
        <p className="text-sm text-neutral-400 italic">No synopsis yet.</p>
      )}
      <div className="mt-auto flex flex-wrap gap-3 text-xs text-neutral-600 pt-2">
        <span>{formatChapterCount(story.chapterCount)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatWordCount(story.totalWordCount)}</span>
        <span aria-hidden="true">·</span>
        <span>Edited {formatRelative(story.updatedAt, now)}</span>
      </div>
    </Link>
  );
}
