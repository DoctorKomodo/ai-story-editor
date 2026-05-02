// AI chat panel — Venice model picker + messages + composer
const { useState: useStateCh, useRef: useRefCh, useEffect: useEffectCh } = React;

function Chat({ model, setModel, onOpenModelPicker, params, onOpenSettings, attachedSelection, clearAttached }) {
  const [input, setInput] = useStateCh("");
  const [tab, setTab] = useStateCh("chat");
  const [messages, setMessages] = useStateCh(SAMPLE_CHAT);
  const taRef = useRefCh(null);
  const bodyRef = useRefCh(null);

  // When text is attached from the editor, flash + focus composer
  useEffectCh(() => {
    if (!attachedSelection) return;
    taRef.current?.focus();
    setInput("Help me with this passage — ");
    // scroll to bottom so the attachment is visible
    requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
    });
  }, [attachedSelection]);

  const send = () => {
    if (!input.trim() && !attachedSelection) return;
    const userMsg = {
      role: "user",
      text: input.trim() || "What can you tell me about this passage?",
      attachment: attachedSelection,
    };
    setMessages(ms => [...ms, userMsg, {
      role: "ai",
      text: "Let me read it in the context of the chapter… The rhythm shifts into short, declarative sentences here — three beats of \"Now he\" pressed together. That's doing a lot of work: it's resignation, but also contempt. Consider whether the final sentence should break the pattern or seal it. Breaking it would admit hope; sealing it would commit to despair.",
      suggestions: [
        { ic: "Wand", text: "Rewrite it with more restraint" },
        { ic: "Compass", text: "What would Cavendish see next?" },
      ],
    }]);
    setInput("");
    clearAttached();
    if (taRef.current) taRef.current.style.height = "auto";
  };

  return (
    <aside className="chat">
      <div className="chat-header">
        <div className="chat-tabs">
          <button className={`chat-tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>Chat</button>
          <button className={`chat-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>History</button>
        </div>
        <div className="chat-actions">
          <button className="icon-btn" title="New chat"><Icons.Plus size={14}/></button>
          <button className="icon-btn" onClick={onOpenSettings} title="Settings"><Icons.Sliders size={14}/></button>
        </div>
      </div>

      <div className="model-bar">
        <div className="row">
          <span className="label">Model</span>
          <button className="model-picker" onClick={onOpenModelPicker}>
            <div className="venice-mark">V</div>
            <span className="model-name">{model.name}</span>
            <span className="ctx-chip">{model.ctx}</span>
            <Icons.ChevronDown size={12} style={{ color: "var(--ink-4)" }}/>
          </button>
        </div>
        <div className="model-params">
          <span className="pp"><span className="k">temp</span><span className="v">{params.temperature.toFixed(2)}</span></span>
          <span className="pp"><span className="k">top_p</span><span className="v">{params.top_p.toFixed(2)}</span></span>
          <span className="pp"><span className="k">max</span><span className="v">{params.max_tokens}</span></span>
          <span style={{ flex: 1 }}/>
          <span className="pp" style={{ color: "var(--ink-4)" }}>{model.params} · {model.family}</span>
        </div>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {messages.map((m, i) => <Message key={i} msg={m}/>)}
        <ContextChip/>
      </div>

      <Composer
        input={input}
        setInput={setInput}
        onSend={send}
        taRef={taRef}
        attachedSelection={attachedSelection}
        clearAttached={clearAttached}
      />
    </aside>
  );
}

function Message({ msg }) {
  const paragraphs = msg.text.split("\n\n");
  return (
    <div className={`msg ${msg.role}`}>
      <div className="who">
        {msg.role === "ai"
          ? <><Icons.Sparkles size={10}/> Venice</>
          : <>You</>
        }
      </div>
      {msg.attachment && (
        <div style={{
          padding: "6px 10px", marginBottom: 4,
          background: "var(--bg-sunken)", borderLeft: "2px solid var(--ink-4)",
          fontFamily: "var(--serif)", fontSize: 12.5, fontStyle: "italic",
          color: "var(--ink-3)", borderRadius: 2,
        }}>
          <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-4)", fontStyle: "normal", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".06em" }}>
            from Ch. {msg.attachment.chapter?.num}
          </div>
          "{msg.attachment.text.length > 160 ? msg.attachment.text.slice(0, 160) + "…" : msg.attachment.text}"
        </div>
      )}
      <div className="bubble">
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {msg.suggestions && (
        <div className="suggestion-chips">
          {msg.suggestions.map((s, i) => {
            const IC = Icons[s.ic];
            return (
              <button key={i} className="chip">
                <span className="ic">{IC ? <IC size={13}/> : null}</span>
                <span>{s.text}</span>
              </button>
            );
          })}
        </div>
      )}
      {msg.role === "ai" && (
        <div style={{ display: "flex", gap: 4, marginTop: 4, color: "var(--ink-5)" }}>
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="Copy"><Icons.Copy size={11}/></button>
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="Regenerate"><Icons.Refresh size={11}/></button>
          <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--ink-5)", alignSelf: "center", marginLeft: 4 }}>
            412 tok · 1.8s
          </span>
        </div>
      )}
    </div>
  );
}

function ContextChip() {
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "center",
      padding: "6px 10px", marginTop: 4,
      background: "var(--bg-sunken)",
      border: "1px dashed var(--line-2)",
      borderRadius: 4,
      fontSize: 11, fontFamily: "var(--mono)",
      color: "var(--ink-4)",
    }}>
      <Icons.Paperclip size={11}/>
      <span>Chapter 3 · 4 characters · 2.4k tokens attached to context</span>
    </div>
  );
}

function Composer({ input, setInput, onSend, taRef, attachedSelection, clearAttached }) {
  const [mode, setMode] = useStateCh("ask");
  return (
    <div className="composer">
      {attachedSelection && (
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start",
          padding: "8px 10px",
          background: "var(--accent-soft)",
          borderRadius: 4,
          fontFamily: "var(--sans)",
          animation: "bubble-in .16s ease-out",
        }}>
          <Icons.Paperclip size={12} style={{ color: "var(--ink-3)", marginTop: 2, flexShrink: 0 }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--ink-4)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>
              Attached from Ch. {attachedSelection.chapter?.num}
            </div>
            <div style={{
              fontFamily: "var(--serif)", fontSize: 12.5, color: "var(--ink-2)",
              fontStyle: "italic", lineHeight: 1.4,
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              "{attachedSelection.text}"
            </div>
          </div>
          <button className="icon-btn" onClick={clearAttached} style={{ width: 20, height: 20, flexShrink: 0 }}>
            <Icons.X size={11}/>
          </button>
        </div>
      )}
      <div className="composer-input">
        <textarea
          ref={taRef}
          rows={1}
          placeholder={attachedSelection ? "Ask about this passage…" : "Ask about your story, describe a scene, or paste text to analyze…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onSend(); }
          }}
          onInput={(e) => {
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
        />
        <button className="send-btn" onClick={onSend} disabled={!input.trim() && !attachedSelection}>
          <Icons.ArrowUp size={14}/>
        </button>
      </div>
      <div className="composer-tools">
        <div className="left">
          <button className={`tool ${mode === "ask" ? "active" : ""}`} onClick={() => setMode("ask")}>
            <Icons.MessageCircle size={11}/> Ask
          </button>
          <button className={`tool ${mode === "rewrite" ? "active" : ""}`} onClick={() => setMode("rewrite")}>
            <Icons.Wand size={11}/> Rewrite
          </button>
          <button className={`tool ${mode === "describe" ? "active" : ""}`} onClick={() => setMode("describe")}>
            <Icons.Sparkles size={11}/> Describe
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>⌘↵ send</span>
        </div>
      </div>
    </div>
  );
}

window.Chat = Chat;
