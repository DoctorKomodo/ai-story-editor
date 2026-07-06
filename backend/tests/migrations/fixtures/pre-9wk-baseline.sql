-- pre-9wk baseline for the migration-squash harness (story-editor-9wk.9).
-- Schema of a database with ONLY the 17 pre-9wk migrations applied, plus the
-- _prisma_migrations bookkeeping rows for those 17 (so `prisma migrate
-- deploy` treats only the consolidated drafts migration as pending).
-- Contains ZERO user/story/narrative rows.
--
-- Regenerate (dev stack up):
--   1. mv backend/prisma/migrations/<STAMP>_drafts /tmp/   (set aside the consolidated migration)
--   2. docker exec story-editor-postgres-1 psql -U storyeditor -d postgres \
--        -c 'DROP DATABASE IF EXISTS squash_baseline' -c 'CREATE DATABASE squash_baseline'
--   3. cd backend && DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/squash_baseline \
--        npx prisma migrate deploy
--   4. mv /tmp/<STAMP>_drafts backend/prisma/migrations/
--   5. Re-run the two pg_dump commands below (see plan
--      docs/superpowers/plans/2026-07-05-drafts-step9-migration-squash.md Task 2)
--
-- PostgreSQL database dump
--

\restrict eUUj2Ztqp23XeE6y586z6bnHDcUeKOzYPqhWwo9T0lGxJBwulaZvyGDgKbB9BxW

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Chapter; Type: TABLE; Schema: public; Owner: storyeditor
--

CREATE TABLE public."Chapter" (
    id text NOT NULL,
    "orderIndex" integer NOT NULL,
    "wordCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "storyId" text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "bodyAuthTag" text,
    "bodyCiphertext" text,
    "bodyIv" text,
    "titleAuthTag" text,
    "titleCiphertext" text,
    "titleIv" text,
    "summaryJsonAuthTag" text,
    "summaryJsonCiphertext" text,
    "summaryJsonIv" text,
    "summaryJsonUpdatedAt" timestamp(3) without time zone
);


ALTER TABLE public."Chapter" OWNER TO storyeditor;

--
-- Name: Character; Type: TABLE; Schema: public; Owner: storyeditor
--

CREATE TABLE public."Character" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "storyId" text NOT NULL,
    initial text,
    color text,
    "ageAuthTag" text,
    "ageCiphertext" text,
    "ageIv" text,
    "appearanceAuthTag" text,
    "appearanceCiphertext" text,
    "appearanceIv" text,
    "arcAuthTag" text,
    "arcCiphertext" text,
    "arcIv" text,
    "backstoryAuthTag" text,
    "backstoryCiphertext" text,
    "backstoryIv" text,
    "nameAuthTag" text,
    "nameCiphertext" text,
    "nameIv" text,
    "personalityAuthTag" text,
    "personalityCiphertext" text,
    "personalityIv" text,
    "roleAuthTag" text,
    "roleCiphertext" text,
    "roleIv" text,
    "voiceAuthTag" text,
    "voiceCiphertext" text,
    "voiceIv" text,
    "orderIndex" integer NOT NULL,
    "relationshipsCiphertext" text,
    "relationshipsIv" text,
    "relationshipsAuthTag" text
);


ALTER TABLE public."Character" OWNER TO storyeditor;

--
-- Name: Chat; Type: TABLE; Schema: public; Owner: storyeditor
--

CREATE TABLE public."Chat" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "chapterId" text NOT NULL,
    "titleAuthTag" text,
    "titleCiphertext" text,
    "titleIv" text,
    kind text DEFAULT 'ask'::text NOT NULL,
    "lastActivityAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Chat" OWNER TO storyeditor;

--
-- Name: Message; Type: TABLE; Schema: public; Owner: storyeditor
--

CREATE TABLE public."Message" (
    id text NOT NULL,
    role text NOT NULL,
    model text,
    tokens integer,
    "latencyMs" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "chatId" text NOT NULL,
    "attachmentJsonAuthTag" text,
    "attachmentJsonCiphertext" text,
    "attachmentJsonIv" text,
    "contentAuthTag" text,
    "contentCiphertext" text,
    "contentIv" text,
    "citationsJsonCiphertext" text,
    "citationsJsonIv" text,
    "citationsJsonAuthTag" text,
    "updatedAt" timestamp(3) without time zone
);


ALTER TABLE public."Message" OWNER TO storyeditor;

--
-- Name: OutlineItem; Type: TABLE; Schema: public; Owner: storyeditor
--

CREATE TABLE public."OutlineItem" (
    id text NOT NULL,
    "order" integer NOT NULL,
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "storyId" text NOT NULL,
    "subAuthTag" text,
    "subCiphertext" text,
    "subIv" text,
    "titleAuthTag" text,
    "titleCiphertext" text,
    "titleIv" text
);


ALTER TABLE public."OutlineItem" OWNER TO storyeditor;

--
-- Name: Story; Type: TABLE; Schema: public; Owner: storyeditor
--

CREATE TABLE public."Story" (
    id text NOT NULL,
    genre text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "userId" text NOT NULL,
    "targetWords" integer,
    "synopsisAuthTag" text,
    "synopsisCiphertext" text,
    "synopsisIv" text,
    "titleAuthTag" text,
    "titleCiphertext" text,
    "titleIv" text,
    "worldNotesAuthTag" text,
    "worldNotesCiphertext" text,
    "worldNotesIv" text,
    "includePreviousChaptersInPrompt" boolean DEFAULT true NOT NULL
);


ALTER TABLE public."Story" OWNER TO storyeditor;

--
-- Name: User; Type: TABLE; Schema: public; Owner: storyeditor
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text,
    "passwordHash" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    name text,
    "settingsJson" jsonb,
    username text NOT NULL,
    "veniceApiKeyEnc" text,
    "veniceApiKeyIv" text,
    "veniceApiKeyAuthTag" text,
    "veniceEndpoint" text,
    "contentDekPasswordAuthTag" text,
    "contentDekPasswordEnc" text,
    "contentDekPasswordIv" text,
    "contentDekPasswordSalt" text,
    "contentDekRecoveryAuthTag" text,
    "contentDekRecoveryEnc" text,
    "contentDekRecoveryIv" text,
    "contentDekRecoverySalt" text
);


ALTER TABLE public."User" OWNER TO storyeditor;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: storyeditor
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO storyeditor;

--
-- Name: Chapter Chapter_pkey; Type: CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Chapter"
    ADD CONSTRAINT "Chapter_pkey" PRIMARY KEY (id);


--
-- Name: Character Character_pkey; Type: CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Character"
    ADD CONSTRAINT "Character_pkey" PRIMARY KEY (id);


--
-- Name: Chat Chat_pkey; Type: CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Chat"
    ADD CONSTRAINT "Chat_pkey" PRIMARY KEY (id);


--
-- Name: Message Message_pkey; Type: CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_pkey" PRIMARY KEY (id);


--
-- Name: OutlineItem OutlineItem_pkey; Type: CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."OutlineItem"
    ADD CONSTRAINT "OutlineItem_pkey" PRIMARY KEY (id);


--
-- Name: Story Story_pkey; Type: CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Story"
    ADD CONSTRAINT "Story_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: Chapter_storyId_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "Chapter_storyId_idx" ON public."Chapter" USING btree ("storyId");


--
-- Name: Chapter_storyId_orderIndex_key; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE UNIQUE INDEX "Chapter_storyId_orderIndex_key" ON public."Chapter" USING btree ("storyId", "orderIndex");


--
-- Name: Character_storyId_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "Character_storyId_idx" ON public."Character" USING btree ("storyId");


--
-- Name: Character_storyId_orderIndex_key; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE UNIQUE INDEX "Character_storyId_orderIndex_key" ON public."Character" USING btree ("storyId", "orderIndex");


--
-- Name: Chat_chapterId_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "Chat_chapterId_idx" ON public."Chat" USING btree ("chapterId");


--
-- Name: Chat_chapterId_kind_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "Chat_chapterId_kind_idx" ON public."Chat" USING btree ("chapterId", kind);


--
-- Name: Chat_chapterId_lastActivityAt_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "Chat_chapterId_lastActivityAt_idx" ON public."Chat" USING btree ("chapterId", "lastActivityAt");


--
-- Name: Message_chatId_createdAt_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "Message_chatId_createdAt_idx" ON public."Message" USING btree ("chatId", "createdAt");


--
-- Name: Message_chatId_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "Message_chatId_idx" ON public."Message" USING btree ("chatId");


--
-- Name: OutlineItem_storyId_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "OutlineItem_storyId_idx" ON public."OutlineItem" USING btree ("storyId");


--
-- Name: OutlineItem_storyId_order_key; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE UNIQUE INDEX "OutlineItem_storyId_order_key" ON public."OutlineItem" USING btree ("storyId", "order");


--
-- Name: Story_userId_idx; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE INDEX "Story_userId_idx" ON public."Story" USING btree ("userId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_username_key; Type: INDEX; Schema: public; Owner: storyeditor
--

CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username);


--
-- Name: Chapter Chapter_storyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Chapter"
    ADD CONSTRAINT "Chapter_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES public."Story"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Character Character_storyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Character"
    ADD CONSTRAINT "Character_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES public."Story"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Chat Chat_chapterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Chat"
    ADD CONSTRAINT "Chat_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES public."Chapter"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Message Message_chatId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES public."Chat"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: OutlineItem OutlineItem_storyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."OutlineItem"
    ADD CONSTRAINT "OutlineItem_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES public."Story"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Story Story_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: storyeditor
--

ALTER TABLE ONLY public."Story"
    ADD CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict eUUj2Ztqp23XeE6y586z6bnHDcUeKOzYPqhWwo9T0lGxJBwulaZvyGDgKbB9BxW

--
-- PostgreSQL database dump
--

\restrict zDcnylV4uoVrAYskjWVeWJeGQMOiPp8zjVgx8CRsPWJfAEMO2plyLLmR4sJ718M

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: storyeditor
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
55d2181d-39e7-431c-95ec-02e5b580603d	4d54a3f8dd2ab66fe50514471fe4502e75880a9edbddcdc6f0f5a8eed10b87bb	2026-07-05 21:42:12.938677+00	20260421162149_init	\N	\N	2026-07-05 21:42:12.899695+00	1
dd607123-f546-4e87-abd0-ccfef816275c	3c43dbd8f0b04c718b09c7c4a6279b4541ccf26fa62c8e4a1df4b87c814c31a9	2026-07-05 21:42:13.043962+00	20260522194808_pcs_chapter_summary_story_toggle	\N	\N	2026-07-05 21:42:13.04105+00	1
e0e532e5-7a3f-437e-867f-579cab66797a	40364730611f527ab9eda8b93a7a79ed816a99fecce46da3f1349aac68ad81ce	2026-07-05 21:42:12.973597+00	20260421170000_add_mockup_driven_extensions	\N	\N	2026-07-05 21:42:12.939392+00	1
b6a49a99-9197-4d06-997f-ec64c495cbe7	4a0350266a344f70ebbe468238f1a43e8a2c91a7a7a60a34f1431fe1ae528940	2026-07-05 21:42:12.984985+00	20260422170517_add_dek_wraps_and_session	\N	\N	2026-07-05 21:42:12.974254+00	1
c9e74eb8-ae2d-4409-bd36-aaa61cf66e3e	5a69f7f80d0999ba665c0310715ad889dffb11bc2da1291e8a31a5e9bef2aacd	2026-07-05 21:42:12.994513+00	20260422172524_add_narrative_ciphertext_columns	\N	\N	2026-07-05 21:42:12.98565+00	1
1dab4cd1-9a6a-478d-a2bf-bde9fb96afa0	efb474bb495b7fc7947abaad3f5c8ad3573e301d1af5a3f00daa0d7f1e145517	2026-07-05 21:42:13.047659+00	20260614130233_add_message_updated_at	\N	\N	2026-07-05 21:42:13.04464+00	1
964e3ce6-a8c5-4fc6-9286-a6685e03b834	a2b4f3fc2993271038c32241874edf59f51fdc8fb2d8a50f78f779b7c23e36b8	2026-07-05 21:42:13.002993+00	20260422211729_drop-plaintext-narrative	\N	\N	2026-07-05 21:42:12.995188+00	1
589f221e-fbfc-4331-85d6-afce397c9c18	e104d678683babe30bcd88c4bcc771dd251668beb70de70cb6d616aba9a55b2b	2026-07-05 21:42:13.011408+00	20260423000000_add_chapter_outline_order_unique	\N	\N	2026-07-05 21:42:13.00369+00	1
7a4cdc47-1746-4ad8-992c-2d750a07414a	b27b0502e9fe0b3112abf5cb74f9d432b2379da7c93bdcebcb1b26991d555f76	2026-07-05 21:42:13.015193+00	20260423090000_add_message_citations	\N	\N	2026-07-05 21:42:13.012439+00	1
9e2fcb44-79fc-49ba-bdb0-f1468f594ebf	140fc1d3b6ca29e8db12195e3b4633ece7b5399c837a1457a8e1fcc4cdf318f6	2026-07-05 21:42:13.050152+00	20260615220710_drop_venice_key_ciphertext	\N	\N	2026-07-05 21:42:13.048627+00	1
be1470cc-9f43-49e3-ad03-a18ad220af3a	466385d9fad7cfd8568b45a44eaef91db84f4377e036360f257d4ad95c0bc0cf	2026-07-05 21:42:13.021056+00	20260501000000_add_character_order_index	\N	\N	2026-07-05 21:42:13.015897+00	1
404928d2-4c1c-431a-9c8c-f21d996440f2	d8cd774479bc27386f63b947f374540c7483bbfb394750060123e1f2e25e90f0	2026-07-05 21:42:13.023962+00	20260504000000_drop_story_system_prompt	\N	\N	2026-07-05 21:42:13.021673+00	1
9ddd21ef-4280-4966-801f-9b7fc5e74ab7	0dd1c28f5a82b25d7b66bb8560b8cb7341882a5b100dc55ac172e983084d7abe	2026-07-05 21:42:13.028617+00	20260507173228_add_chat_kind	\N	\N	2026-07-05 21:42:13.024585+00	1
0148cf59-50c4-43c1-838f-7ae26896c595	00b142f568d3a40776b6177924b053d302532696494485f88331f7be26280f63	2026-07-05 21:42:13.057544+00	20260616205230_drop_session_and_refresh_token	\N	\N	2026-07-05 21:42:13.050832+00	1
ecec3ed0-a3fd-48e8-b91a-f1483b2297a9	a61cb7324bf599a2503f43c6f64a0253c2157f7b2cb8001256413a1e16140677	2026-07-05 21:42:13.033292+00	20260510194835_chat_last_activity_at	\N	\N	2026-07-05 21:42:13.029308+00	1
20ef1bd3-f15f-4828-a2f7-1261f55d0d35	1eff283254712b406af053e78b33abedffd75f167e2a46f86ddd856c2e545068	2026-07-05 21:42:13.036713+00	20260511181949_character_field_consolidation	\N	\N	2026-07-05 21:42:13.033944+00	1
4ac0b29f-73d5-4eef-8042-36726671a0a8	99547827d7b65eca952db52da57656e5e8907debf7d24e14627abe5627fba3bc	2026-07-05 21:42:13.040425+00	20260512183650_rename_message_contentjson_to_content	\N	\N	2026-07-05 21:42:13.03739+00	1
\.


--
-- PostgreSQL database dump complete
--

\unrestrict zDcnylV4uoVrAYskjWVeWJeGQMOiPp8zjVgx8CRsPWJfAEMO2plyLLmR4sJ718M

