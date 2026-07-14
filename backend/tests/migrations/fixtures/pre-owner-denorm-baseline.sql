-- pre-owner-denormalization baseline for the migration harness (story-editor-35u,
-- Task 1). Schema of a database with all 18 pre-owner-denormalization migrations
-- applied (through 20260705233022_drafts), plus the _prisma_migrations bookkeeping
-- rows for those 18 (so `prisma migrate deploy` treats only the new
-- owner_denormalization migration as pending). Contains ZERO rows — the test's
-- own seedSql() inserts a populated multi-user fixture via raw SQL matching this
-- exact (pre-userId) column shape.
--
-- Regenerate (dev stack up, BEFORE any owner_denormalization migration folder
-- exists on disk — i.e. re-run this from a checkout of the parent commit):
--   1. docker exec story-editor-postgres-1 psql -U storyeditor -d postgres \
--        -c 'DROP DATABASE IF EXISTS storyeditor_owner_denorm_baseline' \
--        -c 'CREATE DATABASE storyeditor_owner_denorm_baseline'
--   2. cd backend && DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_owner_denorm_baseline \
--        npx prisma migrate deploy
--   3. docker exec story-editor-postgres-1 pg_dump -U storyeditor \
--        -d storyeditor_owner_denorm_baseline --no-owner --no-privileges \
--        > backend/tests/migrations/fixtures/pre-owner-denorm-baseline.sql
--   4. docker exec story-editor-postgres-1 psql -U storyeditor -d postgres \
--        -c 'DROP DATABASE storyeditor_owner_denorm_baseline WITH (FORCE)'
--
--
-- PostgreSQL database dump
--

\restrict ZbJRJwVZUTzEuT7zlDX13Fg3gdrj8ajSRbJlwWQNMhiZSRqqjcW1qFONbdDw1vU

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
-- Name: Chapter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Chapter" (
    id text NOT NULL,
    "orderIndex" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "storyId" text NOT NULL,
    "titleAuthTag" text,
    "titleCiphertext" text,
    "titleIv" text,
    "activeDraftId" text
);


--
-- Name: Character; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: Chat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Chat" (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "titleAuthTag" text,
    "titleCiphertext" text,
    "titleIv" text,
    kind text DEFAULT 'ask'::text NOT NULL,
    "lastActivityAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "draftId" text NOT NULL
);


--
-- Name: Draft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Draft" (
    id text NOT NULL,
    "bodyCiphertext" text,
    "bodyIv" text,
    "bodyAuthTag" text,
    "summaryJsonCiphertext" text,
    "summaryJsonIv" text,
    "summaryJsonAuthTag" text,
    "summaryJsonUpdatedAt" timestamp(3) without time zone,
    "wordCount" integer DEFAULT 0 NOT NULL,
    "labelCiphertext" text,
    "labelIv" text,
    "labelAuthTag" text,
    "orderIndex" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "chapterId" text NOT NULL
);


--
-- Name: Message; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: OutlineItem; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: Story; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
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


--
-- Data for Name: Chapter; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Chapter" (id, "orderIndex", "createdAt", "updatedAt", "storyId", "titleAuthTag", "titleCiphertext", "titleIv", "activeDraftId") FROM stdin;
\.


--
-- Data for Name: Character; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Character" (id, "createdAt", "updatedAt", "storyId", initial, color, "ageAuthTag", "ageCiphertext", "ageIv", "appearanceAuthTag", "appearanceCiphertext", "appearanceIv", "arcAuthTag", "arcCiphertext", "arcIv", "backstoryAuthTag", "backstoryCiphertext", "backstoryIv", "nameAuthTag", "nameCiphertext", "nameIv", "personalityAuthTag", "personalityCiphertext", "personalityIv", "roleAuthTag", "roleCiphertext", "roleIv", "voiceAuthTag", "voiceCiphertext", "voiceIv", "orderIndex", "relationshipsCiphertext", "relationshipsIv", "relationshipsAuthTag") FROM stdin;
\.


--
-- Data for Name: Chat; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Chat" (id, "createdAt", "updatedAt", "titleAuthTag", "titleCiphertext", "titleIv", kind, "lastActivityAt", "draftId") FROM stdin;
\.


--
-- Data for Name: Draft; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Draft" (id, "bodyCiphertext", "bodyIv", "bodyAuthTag", "summaryJsonCiphertext", "summaryJsonIv", "summaryJsonAuthTag", "summaryJsonUpdatedAt", "wordCount", "labelCiphertext", "labelIv", "labelAuthTag", "orderIndex", "createdAt", "updatedAt", "chapterId") FROM stdin;
\.


--
-- Data for Name: Message; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Message" (id, role, model, tokens, "latencyMs", "createdAt", "chatId", "attachmentJsonAuthTag", "attachmentJsonCiphertext", "attachmentJsonIv", "contentAuthTag", "contentCiphertext", "contentIv", "citationsJsonCiphertext", "citationsJsonIv", "citationsJsonAuthTag", "updatedAt") FROM stdin;
\.


--
-- Data for Name: OutlineItem; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."OutlineItem" (id, "order", status, "createdAt", "updatedAt", "storyId", "subAuthTag", "subCiphertext", "subIv", "titleAuthTag", "titleCiphertext", "titleIv") FROM stdin;
\.


--
-- Data for Name: Story; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."Story" (id, genre, "createdAt", "updatedAt", "userId", "targetWords", "synopsisAuthTag", "synopsisCiphertext", "synopsisIv", "titleAuthTag", "titleCiphertext", "titleIv", "worldNotesAuthTag", "worldNotesCiphertext", "worldNotesIv", "includePreviousChaptersInPrompt") FROM stdin;
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."User" (id, email, "passwordHash", "createdAt", "updatedAt", name, "settingsJson", username, "veniceApiKeyEnc", "veniceApiKeyIv", "veniceApiKeyAuthTag", "veniceEndpoint", "contentDekPasswordAuthTag", "contentDekPasswordEnc", "contentDekPasswordIv", "contentDekPasswordSalt", "contentDekRecoveryAuthTag", "contentDekRecoveryEnc", "contentDekRecoveryIv", "contentDekRecoverySalt") FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
9bcef8a4-0723-4cf8-9f3d-30e6f3c63486	4d54a3f8dd2ab66fe50514471fe4502e75880a9edbddcdc6f0f5a8eed10b87bb	2026-07-13 12:30:20.118395+00	20260421162149_init	\N	\N	2026-07-13 12:30:20.079717+00	1
cd01b53a-2598-472e-b9f7-ac2ca591970a	3c43dbd8f0b04c718b09c7c4a6279b4541ccf26fa62c8e4a1df4b87c814c31a9	2026-07-13 12:30:20.229259+00	20260522194808_pcs_chapter_summary_story_toggle	\N	\N	2026-07-13 12:30:20.226106+00	1
2f03e022-cc94-4828-88ca-ec53239a76ea	40364730611f527ab9eda8b93a7a79ed816a99fecce46da3f1349aac68ad81ce	2026-07-13 12:30:20.151684+00	20260421170000_add_mockup_driven_extensions	\N	\N	2026-07-13 12:30:20.119136+00	1
5b61e005-b811-4a51-86a9-2ac7c483699f	4a0350266a344f70ebbe468238f1a43e8a2c91a7a7a60a34f1431fe1ae528940	2026-07-13 12:30:20.168455+00	20260422170517_add_dek_wraps_and_session	\N	\N	2026-07-13 12:30:20.152379+00	1
bd7daf0e-1c2f-4505-80fa-5ef02765bfed	5a69f7f80d0999ba665c0310715ad889dffb11bc2da1291e8a31a5e9bef2aacd	2026-07-13 12:30:20.179863+00	20260422172524_add_narrative_ciphertext_columns	\N	\N	2026-07-13 12:30:20.169281+00	1
da7e8877-5c8d-4e4f-b207-932e9f25f90f	efb474bb495b7fc7947abaad3f5c8ad3573e301d1af5a3f00daa0d7f1e145517	2026-07-13 12:30:20.231944+00	20260614130233_add_message_updated_at	\N	\N	2026-07-13 12:30:20.229879+00	1
4925ce2c-133f-4bf5-900d-8442466bd906	a2b4f3fc2993271038c32241874edf59f51fdc8fb2d8a50f78f779b7c23e36b8	2026-07-13 12:30:20.188238+00	20260422211729_drop-plaintext-narrative	\N	\N	2026-07-13 12:30:20.180552+00	1
a2ed81a6-fb25-4716-b2db-a89bde0dae16	e104d678683babe30bcd88c4bcc771dd251668beb70de70cb6d616aba9a55b2b	2026-07-13 12:30:20.195609+00	20260423000000_add_chapter_outline_order_unique	\N	\N	2026-07-13 12:30:20.188878+00	1
bbbd588a-f4bc-45b6-9f69-056236ddf5a2	b27b0502e9fe0b3112abf5cb74f9d432b2379da7c93bdcebcb1b26991d555f76	2026-07-13 12:30:20.198391+00	20260423090000_add_message_citations	\N	\N	2026-07-13 12:30:20.196225+00	1
cc41759a-98eb-4460-8bb7-c68e0c0b1aad	140fc1d3b6ca29e8db12195e3b4633ece7b5399c837a1457a8e1fcc4cdf318f6	2026-07-13 12:30:20.234092+00	20260615220710_drop_venice_key_ciphertext	\N	\N	2026-07-13 12:30:20.232602+00	1
b5024f54-12de-497f-b3b9-aec98ecbd741	466385d9fad7cfd8568b45a44eaef91db84f4377e036360f257d4ad95c0bc0cf	2026-07-13 12:30:20.204303+00	20260501000000_add_character_order_index	\N	\N	2026-07-13 12:30:20.199077+00	1
18f90d43-559f-4907-aac4-175a6d2cf221	d8cd774479bc27386f63b947f374540c7483bbfb394750060123e1f2e25e90f0	2026-07-13 12:30:20.208538+00	20260504000000_drop_story_system_prompt	\N	\N	2026-07-13 12:30:20.205304+00	1
13eea480-0616-4967-864d-85ea20806158	0dd1c28f5a82b25d7b66bb8560b8cb7341882a5b100dc55ac172e983084d7abe	2026-07-13 12:30:20.213294+00	20260507173228_add_chat_kind	\N	\N	2026-07-13 12:30:20.209201+00	1
227ce4be-85de-440f-8dc7-8d7b52e95b8b	00b142f568d3a40776b6177924b053d302532696494485f88331f7be26280f63	2026-07-13 12:30:20.241461+00	20260616205230_drop_session_and_refresh_token	\N	\N	2026-07-13 12:30:20.234733+00	1
c5ba9bac-c8d2-407b-ab23-668048d6b4d3	a61cb7324bf599a2503f43c6f64a0253c2157f7b2cb8001256413a1e16140677	2026-07-13 12:30:20.21825+00	20260510194835_chat_last_activity_at	\N	\N	2026-07-13 12:30:20.213961+00	1
e0e7df72-67e9-464b-a28a-24a4dfa9022c	1eff283254712b406af053e78b33abedffd75f167e2a46f86ddd856c2e545068	2026-07-13 12:30:20.221732+00	20260511181949_character_field_consolidation	\N	\N	2026-07-13 12:30:20.218894+00	1
593054ef-2d95-42f8-924e-d4605326eab5	99547827d7b65eca952db52da57656e5e8907debf7d24e14627abe5627fba3bc	2026-07-13 12:30:20.225428+00	20260512183650_rename_message_contentjson_to_content	\N	\N	2026-07-13 12:30:20.222389+00	1
c7c0697d-f4d2-45f7-a4c3-88aa31c3f87b	35a9b1965e387b5ef3e1ceb2e95c9059879b1766ced4f49b85cdf0118388a09a	2026-07-13 12:30:20.270127+00	20260705233022_drafts	\N	\N	2026-07-13 12:30:20.242147+00	1
\.


--
-- Name: Chapter Chapter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Chapter"
    ADD CONSTRAINT "Chapter_pkey" PRIMARY KEY (id);


--
-- Name: Character Character_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Character"
    ADD CONSTRAINT "Character_pkey" PRIMARY KEY (id);


--
-- Name: Chat Chat_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Chat"
    ADD CONSTRAINT "Chat_pkey" PRIMARY KEY (id);


--
-- Name: Draft Draft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Draft"
    ADD CONSTRAINT "Draft_pkey" PRIMARY KEY (id);


--
-- Name: Message Message_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_pkey" PRIMARY KEY (id);


--
-- Name: OutlineItem OutlineItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutlineItem"
    ADD CONSTRAINT "OutlineItem_pkey" PRIMARY KEY (id);


--
-- Name: Story Story_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Story"
    ADD CONSTRAINT "Story_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: Chapter_activeDraftId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Chapter_activeDraftId_key" ON public."Chapter" USING btree ("activeDraftId");


--
-- Name: Chapter_storyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Chapter_storyId_idx" ON public."Chapter" USING btree ("storyId");


--
-- Name: Chapter_storyId_orderIndex_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Chapter_storyId_orderIndex_key" ON public."Chapter" USING btree ("storyId", "orderIndex");


--
-- Name: Character_storyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Character_storyId_idx" ON public."Character" USING btree ("storyId");


--
-- Name: Character_storyId_orderIndex_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Character_storyId_orderIndex_key" ON public."Character" USING btree ("storyId", "orderIndex");


--
-- Name: Chat_draftId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Chat_draftId_idx" ON public."Chat" USING btree ("draftId");


--
-- Name: Chat_draftId_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Chat_draftId_kind_idx" ON public."Chat" USING btree ("draftId", kind);


--
-- Name: Chat_draftId_lastActivityAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Chat_draftId_lastActivityAt_idx" ON public."Chat" USING btree ("draftId", "lastActivityAt");


--
-- Name: Draft_chapterId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Draft_chapterId_idx" ON public."Draft" USING btree ("chapterId");


--
-- Name: Draft_chapterId_orderIndex_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Draft_chapterId_orderIndex_key" ON public."Draft" USING btree ("chapterId", "orderIndex");


--
-- Name: Message_chatId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Message_chatId_createdAt_idx" ON public."Message" USING btree ("chatId", "createdAt");


--
-- Name: Message_chatId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Message_chatId_idx" ON public."Message" USING btree ("chatId");


--
-- Name: OutlineItem_storyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OutlineItem_storyId_idx" ON public."OutlineItem" USING btree ("storyId");


--
-- Name: OutlineItem_storyId_order_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OutlineItem_storyId_order_key" ON public."OutlineItem" USING btree ("storyId", "order");


--
-- Name: Story_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Story_userId_idx" ON public."Story" USING btree ("userId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_username_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username);


--
-- Name: Chapter Chapter_activeDraftId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Chapter"
    ADD CONSTRAINT "Chapter_activeDraftId_fkey" FOREIGN KEY ("activeDraftId") REFERENCES public."Draft"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Chapter Chapter_storyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Chapter"
    ADD CONSTRAINT "Chapter_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES public."Story"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Character Character_storyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Character"
    ADD CONSTRAINT "Character_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES public."Story"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Chat Chat_draftId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Chat"
    ADD CONSTRAINT "Chat_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES public."Draft"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Draft Draft_chapterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Draft"
    ADD CONSTRAINT "Draft_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES public."Chapter"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Message Message_chatId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES public."Chat"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: OutlineItem OutlineItem_storyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutlineItem"
    ADD CONSTRAINT "OutlineItem_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES public."Story"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Story Story_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Story"
    ADD CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict ZbJRJwVZUTzEuT7zlDX13Fg3gdrj8ajSRbJlwWQNMhiZSRqqjcW1qFONbdDw1vU

