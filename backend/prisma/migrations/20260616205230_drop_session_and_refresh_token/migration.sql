-- Drop Session and RefreshToken tables (cookie-session auth cutover).
-- Data loss is intentional: these rows are session/token data only, not
-- narrative content. Dropping them causes a one-time logout of all active
-- sessions. No narrative tables (Story, Chapter, Character, OutlineItem,
-- Chat, Message) are touched.

-- DropForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropTable
DROP TABLE "RefreshToken";

-- DropTable
DROP TABLE "Session";
