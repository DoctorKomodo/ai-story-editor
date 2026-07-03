import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { buildExport } from '../../src/services/export.service';
import { resetDb } from '../helpers/db';
import { makeUserContext } from '../repos/_req';

describe('export.service — id + snapshotUpdatedAt', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('carries the live story id and a snapshotUpdatedAt that bumps when a deep child changes', async () => {
    const ctx = await makeUserContext();
    const storyRepo = createStoryRepo(ctx.req);
    const chapterRepo = createChapterRepo(ctx.req);
    const chatRepo = createChatRepo(ctx.req);
    const messageRepo = createMessageRepo(ctx.req);

    const story = await storyRepo.create({ title: 'Export me' });
    const chapter = await chapterRepo.create({
      storyId: story.id as string,
      title: 'Ch1',
      orderIndex: 0,
    });
    const chat = await chatRepo.create({ chapterId: chapter.id });
    const message = await messageRepo.create({
      chatId: chat.id,
      role: 'user',
      content: 'first draft',
    });

    const firstExport = await buildExport(ctx.req);
    expect(firstExport.stories).toHaveLength(1);
    const firstStory = firstExport.stories[0];
    expect(firstStory.id).toBe(story.id);
    expect(firstStory.snapshotUpdatedAt).toBeTruthy();

    await new Promise((r) => setTimeout(r, 5));
    await messageRepo.update(message.id, chat.id, { content: 'revised draft' });

    const secondExport = await buildExport(ctx.req);
    const secondStory = secondExport.stories[0];
    expect(secondStory.id).toBe(story.id);
    expect(new Date(secondStory.snapshotUpdatedAt as string).getTime()).toBeGreaterThan(
      new Date(firstStory.snapshotUpdatedAt as string).getTime(),
    );
  });
});
