// Sample fantasy story data
const SAMPLE_STORY = {
  id: "s1",
  title: "The Obsidian Key",
  genre: "Fantasy",
  wordCount: 42318,
  targetWords: 90000,
  chapters: [
    { id: "c1", num: 1, title: "The Churn at Dawn", words: 2847, status: "draft" },
    { id: "c2", num: 2, title: "A Visitor from the North", words: 3102, status: "draft" },
    { id: "c3", num: 3, title: "What Ilonoré Brought", words: 2915, status: "revising" },
    { id: "c4", num: 4, title: "The Weight of Ashes", words: 3480, status: "draft" },
    { id: "c5", num: 5, title: "Maulster's Jaw", words: 2641, status: "draft" },
    { id: "c6", num: 6, title: "The Battle of Whispering Spires", words: 4122, status: "final" },
    { id: "c7", num: 7, title: "Obsidian & Salt", words: 2803, status: "draft" },
    { id: "c8", num: 8, title: "The Cottage Burns", words: 2117, status: "outline" },
    { id: "c9", num: 9, title: "Eliza's Shadow", words: 0, status: "outline" },
  ],
  characters: [
    {
      id: "ch1", name: "Cavendish Ernst", role: "Protagonist",
      age: 47, appearance: "Weathered hands, graying beard, missing left earlobe",
      voice: "Terse, observational, occasional dry wit",
      arc: "A fallen hero hiding as a butter churner, forced to reckon with his past when the Obsidian Key resurfaces.",
      initial: "C", color: "#d4c9b0",
    },
    {
      id: "ch2", name: "Ilonoré", role: "Messenger",
      age: 29, appearance: "Frost-white hair, dark frilled apron, cotton gloves that never come off",
      voice: "Formal, pointed, speaks in aphorisms",
      arc: "Sent by a faction long thought extinct. Carries news that Cavendish cannot refuse.",
      initial: "I", color: "#c8b8d4",
    },
    {
      id: "ch3", name: "Maulster Thorne", role: "Antagonist (past)",
      age: "deceased",
      appearance: "A presence in memory. Broken jaw, hollow eyes.",
      voice: "Low, grinding — heard only in Cavendish's dreams",
      arc: "The man Cavendish killed at Whispering Spires. His death is the wound the story circles.",
      initial: "M", color: "#b8a894",
    },
    {
      id: "ch4", name: "Eliza", role: "Sister (deceased)",
      age: "d. 31",
      appearance: "Auburn hair, ink-stained fingers",
      voice: "Warm, wry, quick to laugh",
      arc: "Her death at the Battle frames every choice Cavendish now makes.",
      initial: "E", color: "#d4b8a8",
    },
  ],
  outline: [
    { id: "o1", title: "Act I — The Churn", status: "done", sub: "Ch. 1–3 • Introduce Cavendish's hiding; arrival of Ilonoré." },
    { id: "o2", title: "Act II — The Return", status: "current", sub: "Ch. 4–7 • Reckoning with the past; the Key is named." },
    { id: "o3", title: "Midpoint: the Cottage", status: "todo", sub: "Ch. 8 • Cavendish must choose to leave safety behind." },
    { id: "o4", title: "Act III — The Spires", status: "todo", sub: "Ch. 9–12 • Return to the battlefield." },
    { id: "o5", title: "Resolution", status: "todo", sub: "Ch. 13 • What the Key opens." },
  ],
};

const OTHER_STORIES = [
  { id: "s2", title: "Saltwater Saints", wc: 12040 },
  { id: "s3", title: "A Kinder Machine", wc: 68210 },
  { id: "s4", title: "The Last Train to Hexthorpe", wc: 3100 },
];

// Venice models
const VENICE_MODELS = [
  {
    id: "venice-uncensored",
    name: "venice-uncensored",
    family: "Dolphin 2.9.2",
    desc: "Venice's flagship open model. Tuned for long-form creative writing with reduced refusals.",
    ctx: "32k",
    params: "70B",
    speed: "medium",
    recommended: true,
  },
  {
    id: "llama-3.1-405b",
    name: "llama-3.1-405b",
    family: "Meta Llama 3.1",
    desc: "Largest available model. Best for complex reasoning and nuanced prose.",
    ctx: "65k",
    params: "405B",
    speed: "slow",
  },
  {
    id: "llama-3.3-70b",
    name: "llama-3.3-70b",
    family: "Meta Llama 3.3",
    desc: "Strong all-rounder. Good balance of quality and latency.",
    ctx: "64k",
    params: "70B",
    speed: "fast",
  },
  {
    id: "qwen-2.5-coder-32b",
    name: "qwen-2.5-coder-32b",
    family: "Qwen 2.5",
    desc: "Optimized for structured output. Useful for outlining and world-bible generation.",
    ctx: "32k",
    params: "32B",
    speed: "fast",
  },
  {
    id: "deepseek-r1-llama-70b",
    name: "deepseek-r1-llama-70b",
    family: "DeepSeek R1",
    desc: "Reasoning model. Slower but excels at plot consistency checks.",
    ctx: "64k",
    params: "70B",
    speed: "slow",
  },
];

const SAMPLE_CHAT = [
  {
    role: "user",
    text: "What's Cavendish's emotional state at the start of chapter 3? I want to make sure the shift feels earned.",
  },
  {
    role: "ai",
    text: "At the end of chapter 2, Cavendish has just watched Ilonoré leave without answering his one direct question. He's described as \"standing in the doorway until the churn's rhythm was the only sound left.\"\n\nFor chapter 3 to feel earned, the opening should sit in that silence — not move him forward yet. A suggestion: begin with him cleaning the churn, methodically, the way he used to clean the Obsidian Key. The reader doesn't need to know that yet. Let the object-memory do the work.\n\nWant me to draft an opening paragraph in your voice?",
    suggestions: [
      { ic: "Sparkles", text: "Draft an opening paragraph" },
      { ic: "Compass", text: "Show me Ilonoré's probable next move" },
      { ic: "Users", text: "Check Cavendish's voice consistency" },
    ],
  },
];

window.SAMPLE_STORY = SAMPLE_STORY;
window.OTHER_STORIES = OTHER_STORIES;
window.VENICE_MODELS = VENICE_MODELS;
window.SAMPLE_CHAT = SAMPLE_CHAT;
