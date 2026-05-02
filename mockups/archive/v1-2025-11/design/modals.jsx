// Modals: settings, story picker, character popover, model picker
const { useState: useStateM } = React;

function SettingsModal({ open, onClose, params, setParams, model, setModel, theme, setTheme }) {
  const [section, setSection] = useStateM("venice");
  const [keyVisible, setKeyVisible] = useStateM(false);
  const [apiKey, setApiKey] = useStateM("vn_••••••••••••••••RK7a");

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Settings</h2>
            <div className="sub">Configure Venice.ai integration, writing preferences, and self-hosting</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14}/></button>
        </div>

        <div className="settings-nav">
          {[
            ["venice", "Venice.ai", Icons.Sparkles],
            ["models", "Models", Icons.Cpu],
            ["writing", "Writing", Icons.Feather],
            ["appearance", "Appearance", Icons.Type],
          ].map(([k, label, Ic]) => (
            <button key={k} className={section === k ? "active" : ""} onClick={() => setSection(k)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Ic size={13}/> {label}
              </span>
            </button>
          ))}
        </div>

        <div className="modal-body">
          {section === "venice" && <VeniceSection apiKey={apiKey} setApiKey={setApiKey} keyVisible={keyVisible} setKeyVisible={setKeyVisible}/>}
          {section === "models" && <ModelsSection model={model} setModel={setModel} params={params} setParams={setParams}/>}
          {section === "writing" && <WritingSection/>}
          {section === "appearance" && <AppearanceSection theme={theme} setTheme={setTheme}/>}
        </div>

        <div className="modal-footer">
          <div className="hint">Changes save automatically to your local vault</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={onClose}><Icons.Check size={13}/> Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VeniceSection({ apiKey, setApiKey, keyVisible, setKeyVisible }) {
  return (
    <>
      <div className="settings-section">
        <h3>Connection</h3>
        <p className="section-sub">
          Your API key is stored locally and sent only to Venice.ai. Inkwell never proxies your traffic.
        </p>
        <div className="field">
          <label>
            API Key
            <span className="hint">From venice.ai → Settings → API</span>
          </label>
          <div className="control">
            <div className="api-key-row">
              <input
                className="text-input"
                type={keyVisible ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="icon-btn" onClick={() => setKeyVisible(v => !v)} title={keyVisible ? "Hide" : "Show"}>
                {keyVisible ? <Icons.EyeOff size={14}/> : <Icons.Eye size={14}/>}
              </button>
            </div>
            <span className="key-status"><Icons.Check size={10}/> Verified · 2.2k credits</span>
          </div>
        </div>
        <div className="field">
          <label>Endpoint <span className="hint">Override for self-hosted proxies</span></label>
          <div className="control">
            <input className="text-input" defaultValue="https://api.venice.ai/api/v1" style={{ flex: 1 }}/>
          </div>
        </div>
        <div className="field">
          <label>Organization <span className="hint">Optional — for team accounts</span></label>
          <div className="control">
            <input className="text-input sans" placeholder="(none)" style={{ flex: 1 }}/>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Features</h3>
        <p className="section-sub">Toggle which Venice capabilities Inkwell is allowed to use.</p>
        {[
          ["Chat completions", "Ask panel, inline Q&A", true],
          ["Text continuation", "Continue-writing from cursor", true],
          ["Inline rewrite", "Selection-based rewrites", true],
          ["Image generation", "Character portraits, scene imagery", false],
          ["Character extraction", "Auto-detect characters from prose", true],
          ["Embeddings", "Semantic search across chapters", false],
        ].map(([label, hint, on]) => (
          <FieldToggle key={label} label={label} hint={hint} initial={on}/>
        ))}
      </div>

      <div className="settings-section">
        <h3>Privacy</h3>
        <div className="field">
          <label>Request logging <span className="hint">Store prompts/responses for review</span></label>
          <div className="control"><Toggle initial={false}/><span style={{ fontSize: 12, color: "var(--ink-4)" }}>Off</span></div>
        </div>
        <div className="field">
          <label>Send story context <span className="hint">Include chapter + characters in every request</span></label>
          <div className="control"><Toggle initial={true}/><span style={{ fontSize: 12, color: "var(--ink-4)" }}>Smart (2.4k–6k tokens)</span></div>
        </div>
      </div>
    </>
  );
}

function ModelsSection({ model, setModel, params, setParams }) {
  return (
    <>
      <div className="settings-section">
        <h3>Default model</h3>
        <p className="section-sub">Used for all AI actions unless overridden per-action.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {VENICE_MODELS.map(m => (
            <div
              key={m.id}
              className={`model-option ${model.id === m.id ? "selected" : ""}`}
              onClick={() => setModel(m)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="mo-name">{m.name}</span>
                {m.recommended && <span className="pill-chip"><Icons.Check size={9}/> recommended</span>}
              </div>
              <div className="mo-specs">
                <span>{m.params}</span>
                <span>·</span>
                <span>{m.ctx}</span>
                <span>·</span>
                <span>{m.speed}</span>
              </div>
              <div className="mo-desc">{m.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3>Generation parameters</h3>
        <p className="section-sub">These apply to chat + continuation. Rewrite uses a lower temperature.</p>
        <SliderField label="Temperature" hint="Higher = more surprising prose" min={0} max={2} step={0.05}
          value={params.temperature} onChange={(v) => setParams({...params, temperature: v})}/>
        <SliderField label="Top-p" hint="Nucleus sampling cutoff" min={0} max={1} step={0.05}
          value={params.top_p} onChange={(v) => setParams({...params, top_p: v})}/>
        <SliderField label="Max tokens" hint="Per response" min={128} max={4096} step={64}
          value={params.max_tokens} onChange={(v) => setParams({...params, max_tokens: v})}/>
        <SliderField label="Frequency penalty" hint="Discourage repeated phrasing" min={-2} max={2} step={0.1}
          value={params.freq_penalty} onChange={(v) => setParams({...params, freq_penalty: v})}/>
      </div>

      <div className="settings-section">
        <h3>System prompt</h3>
        <p className="section-sub">Prepended to every request. The story bible is attached separately.</p>
        <div className="field stack">
          <textarea
            className="text-input sans"
            style={{ resize: "vertical", minHeight: 100, padding: 10, fontFamily: "var(--serif)", fontSize: 13, lineHeight: 1.5 }}
            defaultValue={`You are a careful co-writer working inside the novel "The Obsidian Key" — a character-driven fantasy in the style of late Le Guin. Match the existing prose voice: concrete, unhurried, unfussy metaphors. Never break POV. If asked to continue, never exceed the user's requested length.`}
          />
        </div>
      </div>
    </>
  );
}

function WritingSection() {
  return (
    <>
      <div className="settings-section">
        <h3>Editor</h3>
        <FieldToggle label="Typewriter mode" hint="Center current line while writing" initial={false}/>
        <FieldToggle label="Focus current paragraph" hint="Dim surrounding text" initial={true}/>
        <FieldToggle label="Auto-save" hint="Every 4 seconds of inactivity" initial={true}/>
        <FieldToggle label="Smart quotes" hint="Convert ASCII quotes to curly" initial={true}/>
        <FieldToggle label="Em-dash expansion" hint="-- becomes —" initial={true}/>
      </div>
      <div className="settings-section">
        <h3>Daily goal</h3>
        <div className="field">
          <label>Target <span className="hint">Words per day</span></label>
          <div className="control">
            <input className="text-input" defaultValue="1000" style={{ width: 100 }}/>
            <span style={{ fontSize: 12, color: "var(--ink-4)" }}>words</span>
          </div>
        </div>
      </div>
    </>
  );
}

function AppearanceSection({ theme, setTheme }) {
  return (
    <>
      <div className="settings-section">
        <h3>Theme</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[
            ["paper", "Paper", "#faf8f3", "#1a1a1a"],
            ["sepia", "Sepia", "#f4ecd8", "#2d230f"],
            ["dark", "Dark", "#14130f", "#ebe7dc"],
          ].map(([k, label, bg, fg]) => (
            <button
              key={k}
              onClick={() => setTheme(k)}
              style={{
                padding: 14, borderRadius: 4,
                border: `1px solid ${theme === k ? "var(--ink)" : "var(--line-2)"}`,
                background: bg, color: fg,
                fontFamily: "var(--serif)", fontSize: 14,
                cursor: "pointer", textAlign: "left",
                display: "flex", flexDirection: "column", gap: 4,
              }}
            >
              <span style={{ fontStyle: "italic" }}>{label}</span>
              <span style={{ fontSize: 11, opacity: .6, fontFamily: "var(--mono)" }}>Aa · serif</span>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <h3>Typography</h3>
        <div className="field">
          <label>Prose font</label>
          <div className="control">
            <select className="text-input sans" style={{ flex: 1 }} defaultValue="iowan">
              <option value="iowan">Iowan Old Style</option>
              <option value="palatino">Palatino</option>
              <option value="garamond">Garamond</option>
              <option value="ibm">IBM Plex Serif</option>
            </select>
          </div>
        </div>
        <SliderField label="Prose size" min={14} max={24} step={1} value={18} unit="px" onChange={() => {}}/>
        <SliderField label="Line height" min={1.3} max={2} step={0.05} value={1.7} onChange={() => {}}/>
      </div>
    </>
  );
}

function HostingSection() {
  return (
    <>
      <div className="settings-section">
        <h3>Self-hosting</h3>
        <p className="section-sub">Inkwell runs as a Docker stack: Postgres for stories, Redis for sessions, and a thin Node.js API. Your prose never leaves your infrastructure except for Venice.ai calls.</p>
        <div className="field">
          <label>Data directory</label>
          <div className="control">
            <input className="text-input" defaultValue="/var/lib/inkwell" style={{ flex: 1 }}/>
          </div>
        </div>
        <div className="field">
          <label>Backup schedule</label>
          <div className="control">
            <select className="text-input sans" style={{ flex: 1 }} defaultValue="daily">
              <option>Hourly</option><option value="daily">Daily at 03:00</option><option>Weekly</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>Instance <span className="hint">This Inkwell server</span></label>
          <div className="control" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-3)" }}>
            <span className="pill-chip"><Icons.Dot size={8} style={{ color: "#6aa84f" }}/> healthy</span>
            <span>inkwell-01 · v0.4.2 · 3 users</span>
          </div>
        </div>
      </div>
      <div className="settings-section">
        <h3>docker-compose.yml</h3>
        <pre style={{
          background: "var(--bg-sunken)", border: "1px solid var(--line)",
          borderRadius: 4, padding: 12, margin: 0,
          fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.6,
          color: "var(--ink-2)", overflowX: "auto",
        }}>{`services:
  inkwell:
    image: inkwell/app:0.4
    ports: ["3000:3000"]
    env_file: .env
  db:
    image: postgres:16-alpine
    volumes: ["./data/pg:/var/lib/postgresql/data"]
  redis:
    image: redis:7-alpine`}</pre>
      </div>
    </>
  );
}

function FieldToggle({ label, hint, initial }) {
  const [on, setOn] = useStateM(!!initial);
  return (
    <div className="field">
      <label>{label}{hint && <span className="hint">{hint}</span>}</label>
      <div className="control">
        <div className={`toggle ${on ? "on" : ""}`} onClick={() => setOn(!on)}/>
        <span style={{ fontSize: 12, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>{on ? "on" : "off"}</span>
      </div>
    </div>
  );
}

function Toggle({ initial }) {
  const [on, setOn] = useStateM(!!initial);
  return <div className={`toggle ${on ? "on" : ""}`} onClick={() => setOn(!on)}/>;
}

function SliderField({ label, hint, min, max, step, value, onChange, unit = "" }) {
  return (
    <div className="field">
      <label>{label}{hint && <span className="hint">{hint}</span>}</label>
      <div className="control">
        <div className="slider-row">
          <input type="range" min={min} max={max} step={step} value={value}
                 onChange={(e) => onChange(parseFloat(e.target.value))}/>
          <span className="slider-val">{typeof value === "number" ? value.toFixed(step < 1 ? 2 : 0) : value}{unit}</span>
        </div>
      </div>
    </div>
  );
}

/* ===== Story picker ===== */

function StoryPicker({ open, onClose, current }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Your Stories</h2>
            <div className="sub">Switch projects or start a new one</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="modal-body" style={{ padding: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <StoryRow title={current.title} genre={current.genre} wc={current.wordCount} target={current.targetWords} active/>
            {OTHER_STORIES.map(s => (
              <StoryRow key={s.id} title={s.title} wc={s.wc}/>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <span className="hint">{OTHER_STORIES.length + 1} stories in vault</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost"><Icons.Paperclip size={12}/> Import .docx</button>
            <button className="btn primary"><Icons.Plus size={12}/> New story</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoryRow({ title, genre, wc, target, active }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 12px", borderRadius: 4,
      border: `1px solid ${active ? "var(--ink)" : "var(--line)"}`,
      background: active ? "var(--bg-elevated)" : "var(--bg)",
      cursor: "pointer",
    }}>
      <div style={{
        width: 34, height: 44, borderRadius: 2,
        background: "var(--accent-soft)",
        display: "grid", placeItems: "center",
        fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16,
        color: "var(--ink-2)",
      }}>
        {title.split(" ").map(w => w[0]).slice(0, 2).join("")}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink)" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)", marginTop: 2 }}>
          {genre && <>{genre} · </>}{wc.toLocaleString()} words{target && <> / {target.toLocaleString()}</>}
        </div>
      </div>
      {active && <span className="pill-chip">open</span>}
    </div>
  );
}

/* ===== Character popover ===== */

function CharPopover({ char, anchor }) {
  if (!char || !anchor) return null;
  const r = anchor.getBoundingClientRect();
  return (
    <div className="char-popover" style={{
      top: r.bottom + 8,
      left: Math.min(r.left, window.innerWidth - 300),
    }}>
      <div className="cp-head">
        <div className="cp-avatar" style={{ background: char.color }}>{char.initial}</div>
        <div>
          <div className="cp-name">{char.name}</div>
          <div className="cp-role">{char.role} · {char.age}</div>
        </div>
      </div>
      <div className="cp-field">
        <span className="k">Appearance</span>
        <span className="v">{char.appearance}</span>
      </div>
      <div className="cp-field">
        <span className="k">Voice</span>
        <span className="v">{char.voice}</span>
      </div>
      <div className="cp-field">
        <span className="k">Arc</span>
        <span className="v">{char.arc}</span>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
        <button className="btn ghost" style={{ fontSize: 11.5 }}><Icons.Edit3 size={11}/> Edit</button>
        <button className="btn ghost" style={{ fontSize: 11.5 }}><Icons.Sparkles size={11}/> Consistency check</button>
      </div>
    </div>
  );
}

/* ===== Model picker (quick) ===== */

function ModelPickerMenu({ open, onClose, model, setModel }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Choose model</h2>
            <div className="sub">Powered by Venice.ai</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="modal-body" style={{ padding: 12, display: "grid", gap: 8 }}>
          {VENICE_MODELS.map(m => (
            <div
              key={m.id}
              className={`model-option ${model.id === m.id ? "selected" : ""}`}
              onClick={() => { setModel(m); onClose(); }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="mo-name">{m.name}</span>
                {m.recommended && <span className="pill-chip"><Icons.Check size={9}/> recommended</span>}
              </div>
              <div className="mo-specs">
                <span>{m.params}</span><span>·</span>
                <span>{m.ctx}</span><span>·</span>
                <span>{m.speed}</span>
              </div>
              <div className="mo-desc">{m.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.SettingsModal = SettingsModal;
window.StoryPicker = StoryPicker;
window.CharPopover = CharPopover;
window.ModelPickerMenu = ModelPickerMenu;
