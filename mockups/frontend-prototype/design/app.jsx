// App shell — wires sidebar + editor + chat + modals + tweaks
const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp } = React;

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "theme": "paper",
  "layout": "three-col",
  "proseFont": "iowan"
}/*EDITMODE-END*/;

function App() {
  const [user, setUser] = useStateApp(() => {
    try { return JSON.parse(localStorage.getItem("inkwell_user") || "null"); }
    catch { return null; }
  });

  const handleAuth = (u) => {
    localStorage.setItem("inkwell_user", JSON.stringify(u));
    setUser(u);
  };
  const handleSignOut = () => {
    localStorage.removeItem("inkwell_user");
    setUser(null);
  };

  if (!user) return <AuthScreen onAuth={handleAuth}/>;

  return <MainApp user={user} onSignOut={handleSignOut}/>;
}

function MainApp({ user, onSignOut }) {
  const [activeTab, setActiveTab] = useStateApp("chapters");
  const [activeChapter, setActiveChapter] = useStateApp("c1");
  const [charHover, setCharHover] = useStateApp({ char: null, anchor: null });
  const [hasContinuation, setHasContinuation] = useStateApp(false);
  const [attachedSelection, setAttachedSelection] = useStateApp(null);

  const [settingsOpen, setSettingsOpen] = useStateApp(false);
  const [storyPickerOpen, setStoryPickerOpen] = useStateApp(false);
  const [modelPickerOpen, setModelPickerOpen] = useStateApp(false);

  const [model, setModel] = useStateApp(VENICE_MODELS[0]);
  const [params, setParams] = useStateApp({
    temperature: 0.85, top_p: 0.95, max_tokens: 800, freq_penalty: 0.2,
  });

  const [tweaks, setTweaks] = useStateApp(DEFAULT_TWEAKS);
  const [tweaksOpen, setTweaksOpen] = useStateApp(false);

  // Edit mode wiring
  useEffectApp(() => {
    const onMsg = (e) => {
      if (e.data?.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e.data?.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const updateTweak = (k, v) => {
    const next = { ...tweaks, [k]: v };
    setTweaks(next);
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [k]: v } }, "*");
  };

  const handleCharHover = (id, anchor) => {
    if (!id) { setCharHover({ char: null, anchor: null }); return; }
    const c = SAMPLE_STORY.characters.find(x => x.id === id);
    setCharHover({ char: c, anchor });
  };

  const handleContinue = () => {
    setHasContinuation(true);
  };

  const layoutAttr = tweaks.layout === "focus" ? "focus" : tweaks.layout === "nochat" ? "nochat" : "";

  return (
    <div className="app" data-theme={tweaks.theme} data-layout={layoutAttr} style={{
      "--prose-font": tweaks.proseFont === "palatino" ? "Palatino, Georgia, serif"
                    : tweaks.proseFont === "garamond" ? '"EB Garamond", Garamond, serif'
                    : "var(--serif)",
    }}>
      <TopBar
        story={SAMPLE_STORY}
        chapter={SAMPLE_STORY.chapters.find(c => c.id === activeChapter)}
        onOpenSettings={() => setSettingsOpen(true)}
        tweaks={tweaks}
        updateTweak={updateTweak}
        user={user}
        onSignOut={onSignOut}
      />
      <Sidebar
        story={SAMPLE_STORY}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeChapter={activeChapter}
        setActiveChapter={setActiveChapter}
        onOpenChar={(c) => handleCharHover(c.id, document.querySelector(`[data-char="${c.id}"]`))}
        onOpenStoryPicker={() => setStoryPickerOpen(true)}
      />
      <Editor
        story={SAMPLE_STORY}
        activeChapter={activeChapter}
        onCharHover={handleCharHover}
        onContinue={handleContinue}
        hasContinuation={hasContinuation}
        onAskAI={(text) => setAttachedSelection({ text, chapter: SAMPLE_STORY.chapters.find(c => c.id === activeChapter) })}
      />
      <Chat
        model={model}
        setModel={setModel}
        params={params}
        onOpenModelPicker={() => setModelPickerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        attachedSelection={attachedSelection}
        clearAttached={() => setAttachedSelection(null)}
      />

      {charHover.char && <CharPopover char={charHover.char} anchor={charHover.anchor}/>}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        params={params}
        setParams={setParams}
        model={model}
        setModel={setModel}
        theme={tweaks.theme}
        setTheme={(t) => updateTweak("theme", t)}
      />
      <StoryPicker open={storyPickerOpen} onClose={() => setStoryPickerOpen(false)} current={SAMPLE_STORY}/>
      <ModelPickerMenu open={modelPickerOpen} onClose={() => setModelPickerOpen(false)} model={model} setModel={setModel}/>

      {tweaksOpen && <TweaksPanel tweaks={tweaks} updateTweak={updateTweak} onClose={() => setTweaksOpen(false)}/>}
    </div>
  );
}

function TopBar({ story, chapter, onOpenSettings, user, onSignOut }) {
  const [menuOpen, setMenuOpen] = useStateApp(false);
  const initials = (user?.name || user?.username || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
            <line x1="16" y1="8" x2="2" y2="22"/>
            <line x1="17.5" y1="15" x2="9" y2="15"/>
          </svg>
        </div>
        Inkwell
      </div>

      <div className="crumbs">
        <span>{story.title}</span>
        <span className="sep">/</span>
        <span>Chapter {chapter?.num}</span>
        <span className="sep">/</span>
        <span className="current">{chapter?.title}</span>
      </div>

      <div className="meta">
        <span className="saved"><span className="dot"/>Saved · 12s ago</span>
        <span>{story.wordCount.toLocaleString()} words</span>
        <span style={{ color: "var(--ink-5)" }}>|</span>
        <button className="icon-btn" title="History"><Icons.History size={14}/></button>
        <button className="icon-btn" title="Focus mode"><Icons.Focus size={14}/></button>
        <button className="icon-btn" onClick={onOpenSettings} title="Settings"><Icons.Settings size={14}/></button>
        <div style={{ position: "relative" }}>
          <div
            onClick={() => setMenuOpen(v => !v)}
            style={{
              width: 26, height: 26, borderRadius: "50%",
              background: "var(--accent-soft)",
              border: "1px solid var(--line-2)",
              display: "grid", placeItems: "center",
              fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12,
              color: "var(--ink-2)", cursor: "pointer",
            }}
            title={user?.name}
          >{initials}</div>
          {menuOpen && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 60 }} onClick={() => setMenuOpen(false)}/>
              <div style={{
                position: "absolute", top: 34, right: 0, zIndex: 61,
                width: 220, background: "var(--bg-elevated)",
                border: "1px solid var(--line-2)", borderRadius: 6,
                boxShadow: "var(--shadow-pop)", padding: 6,
                fontFamily: "var(--sans)",
              }}>
                <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                  <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{user?.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>@{user?.username}</div>
                </div>
                <MenuItem icon={Icons.Settings} label="Settings" onClick={() => { setMenuOpen(false); onOpenSettings(); }}/>
                <MenuItem icon={Icons.Book} label="Your stories"/>
                <MenuItem icon={Icons.Shield} label="Account & privacy"/>
                <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }}/>
                <MenuItem icon={Icons.X} label="Sign out" onClick={onSignOut} danger/>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuItem({ icon: Ic, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", padding: "6px 10px", borderRadius: 3,
        fontSize: 13, color: danger ? "var(--danger)" : "var(--ink-2)",
        textAlign: "left", transition: "background .1s",
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-hover)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <Ic size={13} style={{ color: danger ? "var(--danger)" : "var(--ink-4)" }}/>
      {label}
    </button>
  );
}

function TweaksPanel({ tweaks, updateTweak, onClose }) {
  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <div className="t">Tweaks <span className="sub">live preview</span></div>
        <button className="icon-btn" onClick={onClose}><Icons.X size={12}/></button>
      </div>
      <div className="tweaks-body">
        <TweakRow label="Theme" options={[
          ["paper", "Paper"], ["sepia", "Sepia"], ["dark", "Dark"],
        ]} value={tweaks.theme} onChange={(v) => updateTweak("theme", v)}/>
        <TweakRow label="Layout" options={[
          ["three-col", "Full"], ["nochat", "No chat"], ["focus", "Focus"],
        ]} value={tweaks.layout} onChange={(v) => updateTweak("layout", v)}/>
        <TweakRow label="Prose font" options={[
          ["iowan", "Iowan"], ["palatino", "Palatino"], ["garamond", "Garamond"],
        ]} value={tweaks.proseFont} onChange={(v) => updateTweak("proseFont", v)}/>
      </div>
    </div>
  );
}

function TweakRow({ label, options, value, onChange }) {
  return (
    <div className="tweak-row">
      <div className="lbl">{label}</div>
      <div className="tweak-opts">
        {options.map(([k, l]) => (
          <button key={k} className={`tweak-opt ${value === k ? "active" : ""}`} onClick={() => onChange(k)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
