-- Data-only: APP_ENCRYPTION_KEY is gone, so existing veniceApiKey ciphertext is
-- unreadable. Drop it; users re-enter their BYOK key once (it is now wrapped by
-- the per-user content DEK). Touches no narrative columns.
UPDATE "User"
SET "veniceApiKeyEnc" = NULL,
    "veniceApiKeyIv" = NULL,
    "veniceApiKeyAuthTag" = NULL;
