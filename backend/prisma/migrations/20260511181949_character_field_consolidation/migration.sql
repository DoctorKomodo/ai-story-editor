-- AlterTable: drop physicalDescription and notes triples, add relationships triple
ALTER TABLE "Character" DROP COLUMN "physicalDescriptionCiphertext",
DROP COLUMN "physicalDescriptionIv",
DROP COLUMN "physicalDescriptionAuthTag",
DROP COLUMN "notesCiphertext",
DROP COLUMN "notesIv",
DROP COLUMN "notesAuthTag",
ADD COLUMN "relationshipsCiphertext" TEXT,
ADD COLUMN "relationshipsIv" TEXT,
ADD COLUMN "relationshipsAuthTag" TEXT;
