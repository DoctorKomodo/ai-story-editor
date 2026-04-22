-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN     "bodyAuthTag" TEXT,
ADD COLUMN     "bodyCiphertext" TEXT,
ADD COLUMN     "bodyIv" TEXT,
ADD COLUMN     "titleAuthTag" TEXT,
ADD COLUMN     "titleCiphertext" TEXT,
ADD COLUMN     "titleIv" TEXT;

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "ageAuthTag" TEXT,
ADD COLUMN     "ageCiphertext" TEXT,
ADD COLUMN     "ageIv" TEXT,
ADD COLUMN     "appearanceAuthTag" TEXT,
ADD COLUMN     "appearanceCiphertext" TEXT,
ADD COLUMN     "appearanceIv" TEXT,
ADD COLUMN     "arcAuthTag" TEXT,
ADD COLUMN     "arcCiphertext" TEXT,
ADD COLUMN     "arcIv" TEXT,
ADD COLUMN     "backstoryAuthTag" TEXT,
ADD COLUMN     "backstoryCiphertext" TEXT,
ADD COLUMN     "backstoryIv" TEXT,
ADD COLUMN     "nameAuthTag" TEXT,
ADD COLUMN     "nameCiphertext" TEXT,
ADD COLUMN     "nameIv" TEXT,
ADD COLUMN     "notesAuthTag" TEXT,
ADD COLUMN     "notesCiphertext" TEXT,
ADD COLUMN     "notesIv" TEXT,
ADD COLUMN     "personalityAuthTag" TEXT,
ADD COLUMN     "personalityCiphertext" TEXT,
ADD COLUMN     "personalityIv" TEXT,
ADD COLUMN     "physicalDescriptionAuthTag" TEXT,
ADD COLUMN     "physicalDescriptionCiphertext" TEXT,
ADD COLUMN     "physicalDescriptionIv" TEXT,
ADD COLUMN     "roleAuthTag" TEXT,
ADD COLUMN     "roleCiphertext" TEXT,
ADD COLUMN     "roleIv" TEXT,
ADD COLUMN     "voiceAuthTag" TEXT,
ADD COLUMN     "voiceCiphertext" TEXT,
ADD COLUMN     "voiceIv" TEXT;

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "titleAuthTag" TEXT,
ADD COLUMN     "titleCiphertext" TEXT,
ADD COLUMN     "titleIv" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attachmentJsonAuthTag" TEXT,
ADD COLUMN     "attachmentJsonCiphertext" TEXT,
ADD COLUMN     "attachmentJsonIv" TEXT,
ADD COLUMN     "contentJsonAuthTag" TEXT,
ADD COLUMN     "contentJsonCiphertext" TEXT,
ADD COLUMN     "contentJsonIv" TEXT;

-- AlterTable
ALTER TABLE "OutlineItem" ADD COLUMN     "subAuthTag" TEXT,
ADD COLUMN     "subCiphertext" TEXT,
ADD COLUMN     "subIv" TEXT,
ADD COLUMN     "titleAuthTag" TEXT,
ADD COLUMN     "titleCiphertext" TEXT,
ADD COLUMN     "titleIv" TEXT;

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "synopsisAuthTag" TEXT,
ADD COLUMN     "synopsisCiphertext" TEXT,
ADD COLUMN     "synopsisIv" TEXT,
ADD COLUMN     "systemPromptAuthTag" TEXT,
ADD COLUMN     "systemPromptCiphertext" TEXT,
ADD COLUMN     "systemPromptIv" TEXT,
ADD COLUMN     "titleAuthTag" TEXT,
ADD COLUMN     "titleCiphertext" TEXT,
ADD COLUMN     "titleIv" TEXT,
ADD COLUMN     "worldNotesAuthTag" TEXT,
ADD COLUMN     "worldNotesCiphertext" TEXT,
ADD COLUMN     "worldNotesIv" TEXT;
