import type { Request } from 'express';
import { EXPORT_FORMAT_VERSION, type ExportFile } from 'story-editor-shared';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createChatRepo } from '../repos/chat.repo';
import { createMessageRepo } from '../repos/message.repo';
import { createOutlineRepo } from '../repos/outline.repo';
import { createStoryRepo } from '../repos/story.repo';

export async function buildExport(req: Request): Promise<ExportFile> {
  const storyRepo = createStoryRepo(req);
  const chapterRepo = createChapterRepo(req);
  const characterRepo = createCharacterRepo(req);
  const outlineRepo = createOutlineRepo(req);
  const chatRepo = createChatRepo(req);
  const messageRepo = createMessageRepo(req);

  const stories = await storyRepo.findManyForUser();
  const out: ExportFile['stories'] = [];

  for (const s of stories) {
    const chapterMetas = await chapterRepo.findManyForStory(s.id, { includeSummary: true });
    const chapters: ExportFile['stories'][number]['chapters'] = [];

    for (const meta of chapterMetas) {
      const full = await chapterRepo.findById(meta.id);
      const chats: ExportFile['stories'][number]['chapters'][number]['chats'] = [];

      for (const c of await chatRepo.findManyForChapter(meta.id)) {
        const messages = await messageRepo.findManyForChat(c.id);
        chats.push({
          title: c.title ?? null,
          kind: c.kind,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            attachmentJson: m.attachmentJson ?? null,
            citationsJson: m.citationsJson ?? null,
            model: m.model ?? null,
            tokens: m.tokens ?? null,
            latencyMs: m.latencyMs ?? null,
            createdAt: m.createdAt.toISOString(),
          })),
        });
      }

      chapters.push({
        title: meta.title,
        status: meta.status,
        orderIndex: meta.orderIndex,
        bodyJson: full?.bodyJson,
        summary: meta.summary ?? null,
        chats,
      });
    }

    const characters = (await characterRepo.findManyForStory(s.id)).map((c) => ({
      name: c.name,
      role: c.role ?? undefined,
      age: c.age ?? undefined,
      appearance: c.appearance ?? undefined,
      personality: c.personality ?? undefined,
      voice: c.voice ?? undefined,
      backstory: c.backstory ?? undefined,
      arc: c.arc ?? undefined,
      relationships: c.relationships ?? undefined,
      color: c.color ?? undefined,
      initial: c.initial ?? undefined,
      orderIndex: c.orderIndex,
    }));

    const outlineItems = (await outlineRepo.findManyForStory(s.id)).map((o) => ({
      title: o.title,
      sub: o.sub ?? undefined,
      status: o.status,
      order: o.order,
    }));

    out.push({
      title: s.title,
      synopsis: s.synopsis ?? undefined,
      genre: s.genre ?? undefined,
      worldNotes: s.worldNotes ?? undefined,
      targetWords: s.targetWords ?? undefined,
      includePreviousChaptersInPrompt: s.includePreviousChaptersInPrompt ?? undefined,
      chapters,
      characters,
      outlineItems,
    });
  }

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    app: 'inkwell',
    exportedAt: new Date().toISOString(),
    stories: out,
  };
}
