// Editor pane — format bar + paper + LIVE selection bubble
const { useState: useStateEd, useRef: useRefEd, useEffect: useEffectEd, useCallback: useCbEd } = React;

function Editor({ story, activeChapter, onCharHover, onContinue, hasContinuation, onAskAI, pulseAskAI }) {
  const chapter = story.chapters.find(c => c.id === activeChapter) || story.chapters[0];
  const scrollRef = useRefEd(null);
  const proseRef = useRefEd(null);

  // Selection bubble state
  const [sel, setSel] = useStateEd(null); // { rect, text } or null
  const [aiAction, setAiAction] = useStateEd(null); // { action, text } when user clicked something

  const updateSelection = useCbEd(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) { setSel(null); return; }
    const range = s.getRangeAt(0);
    // only if selection is inside the prose region
    if (!proseRef.current || !proseRef.current.contains(range.commonAncestorContainer)) {
      setSel(null); return;
    }
    const text = s.toString().trim();
    if (text.length < 2) { setSel(null); return; }

    const rect = range.getBoundingClientRect();
    const scrollRect = scrollRef.current.getBoundingClientRect();
    setSel({
      text,
      // position relative to scrollRef (which is the positioned ancestor)
      top: rect.top - scrollRect.top + scrollRef.current.scrollTop - 44,
      left: rect.left - scrollRect.left + rect.width / 2,
    });
  }, []);

  useEffectEd(() => {
    const onUp = () => setTimeout(updateSelection, 0);
    const onKey = (e) => { if (e.key === "Escape") { setSel(null); window.getSelection()?.removeAllRanges(); } };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("keydown", onKey);
    // Hide on scroll (position becomes stale)
    const scroller = scrollRef.current;
    const onScroll = () => setSel(null);
    scroller?.addEventListener("scroll", onScroll);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("keydown", onKey);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [updateSelection]);

  const runAction = (action) => {
    if (!sel) return;
    if (action === "ask") {
      onAskAI(sel.text);
      setSel(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    // For rewrite / describe / expand — show a small inline result card below the selection
    setAiAction({ action, text: sel.text });
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <section className="editor-pane">
      <FormatBar/>
      <div className="editor-scroll" ref={scrollRef} style={{ position: "relative" }}>
        <div className="editor-paper">
          <h1 className="doc-title">{story.title}</h1>
          <div className="doc-sub">
            <span>{story.genre}</span>
            <span className="dot"/>
            <span>Draft 2</span>
            <span className="dot"/>
            <span>{chapter.words.toLocaleString()} words</span>
            <span className="dot"/>
            <span className="wc-chip"><Icons.Dot size={6}/> {chapter.status}</span>
          </div>

          <h2 className="chapter-title">
            <span><em>Chapter {chapter.num}</em> &nbsp;·&nbsp; {chapter.title}</span>
            <span className="ch-label">§ {String(chapter.num).padStart(2, "0")}</span>
          </h2>

          <div ref={proseRef}>
            <ChapterProse onCharHover={onCharHover} hasContinuation={hasContinuation}/>
          </div>

          {aiAction && <InlineAIResult aiAction={aiAction} onDismiss={() => setAiAction(null)}/>}

          <ContinueAffordance onContinue={onContinue} hasContinuation={hasContinuation}/>

          {!sel && !aiAction && (
            <div style={{
              marginTop: 40, paddingTop: 16, borderTop: "1px dashed var(--line)",
              fontSize: 11.5, color: "var(--ink-4)", fontFamily: "var(--mono)",
              display: "flex", gap: 12, flexWrap: "wrap",
            }}>
              <span>Try:</span>
              <span>select text → rewrite bubble appears</span>
              <span>·</span>
              <span>hover underlined names → character card</span>
              <span>·</span>
              <span>⌥↵ → continue writing</span>
            </div>
          )}
        </div>

        {sel && (
          <SelectionBubble
            top={sel.top}
            left={sel.left}
            onAction={runAction}
            pulseAskAI={pulseAskAI}
          />
        )}
      </div>
    </section>
  );
}

function FormatBar() {
  return (
    <div className="format-bar">
      <div className="group">
        <button className="fb-btn" title="Undo"><Icons.Undo size={14}/></button>
        <button className="fb-btn" title="Redo"><Icons.Redo size={14}/></button>
      </div>
      <div className="group">
        <button className="fb-sel" title="Paragraph style">
          <span>Body</span>
          <Icons.ChevronDown size={11}/>
        </button>
      </div>
      <div className="group">
        <button className="fb-btn active" title="Bold"><Icons.Bold size={14}/></button>
        <button className="fb-btn" title="Italic"><Icons.Italic size={14}/></button>
        <button className="fb-btn" title="Underline"><Icons.Underline size={14}/></button>
        <button className="fb-btn" title="Strike"><Icons.Strike size={14}/></button>
      </div>
      <div className="group">
        <button className="fb-btn" title="H1"><Icons.H1 size={14}/></button>
        <button className="fb-btn" title="H2"><Icons.H2 size={14}/></button>
        <button className="fb-btn" title="Quote"><Icons.Quote size={14}/></button>
      </div>
      <div className="group">
        <button className="fb-btn" title="Bullet list"><Icons.List size={14}/></button>
        <button className="fb-btn" title="Numbered"><Icons.ListOrdered size={14}/></button>
      </div>
      <div className="group">
        <button className="fb-btn" title="Link"><Icons.Link size={14}/></button>
        <button className="fb-btn" title="Highlight"><Icons.Highlight size={14}/></button>
      </div>
      <div style={{ flex: 1 }}/>
      <div className="group" style={{ border: "none", paddingRight: 0, marginRight: 0 }}>
        <button className="fb-btn" title="Find"><Icons.Search size={14}/></button>
        <button className="fb-btn" title="Focus mode"><Icons.Focus size={14}/></button>
      </div>
    </div>
  );
}

function ChapterProse({ onCharHover, hasContinuation }) {
  return (
    <div className="prose">
      <p>
        <span
          className="char-ref"
          onMouseEnter={(e) => onCharHover("ch1", e.currentTarget)}
          onMouseLeave={() => onCharHover(null)}
        >Cavendish Ernst's</span>{" "}
        calloused hands gripped the wooden churn, muscles straining as he pumped the plunger up and down with practiced efficiency. The rhythmic slosh of cream inside the barrel filled his modest kitchen, a familiar soundtrack to his solitary mornings.
      </p>
      <p>
        Sunlight streamed through the dusty windows, illuminating the eclectic decor of his cottage. Faded tapestries depicting heroic deeds hung crookedly on the walls, while tarnished trophies and exotic trinkets cluttered every available surface. It was the home of someone who had once been destined for greatness, now reduced to churning butter for tourists.
      </p>
      <p>
        Cavendish dragged his forearm across his brow, leaving a dark streak on the frilly edge of the apron{" "}
        <span
          className="char-ref"
          onMouseEnter={(e) => onCharHover("ch2", e.currentTarget)}
          onMouseLeave={() => onCharHover(null)}
        >Ilonoré</span>{" "}
        had thrust at him that morning. The cotton pinched at his neck, the strings knotted too tight behind his back. <em>"For the customers,"</em> she'd said, her wrinkled fingers pinching his cheek like he was some village idiot instead of the man who'd once held the Obsidian Key. <em>"They expect a certain… rustic charm."</em>
      </p>
      <p>
        He wrenched the churn's handle clockwise. It groaned, an arthritic complaint from waterlogged wood. Seven minutes, twenty-three seconds now. His knuckles whitened around the grip, the same grip he'd used to shatter{" "}
        <span
          className="char-ref"
          onMouseEnter={(e) => onCharHover("ch3", e.currentTarget)}
          onMouseLeave={() => onCharHover(null)}
        >Maulster Thorne's</span>{" "}
        jawbone at the Battle of Whispering Spires. The memory flashed: scorched fur, crackling air that tasted like metal,{" "}
        <span
          className="char-ref"
          onMouseEnter={(e) => onCharHover("ch4", e.currentTarget)}
          onMouseLeave={() => onCharHover(null)}
        >Eliza's</span>{" "}
        scream bouncing off marble as her brother fell.
      </p>
      <p>
        Now he churned butter. Now he wore an apron with lace trim and smiled at day-trippers who asked if the churn was authentic. They paid in copper half-pennies and left crumbs on his good table. They took photographs with small glass squares and said the word <em>quaint</em> as if it were a compliment.
      </p>
      {hasContinuation && (
        <p>
          <span className="ai-continuation">
            The bell above his door jangled — a thin, tinny sound he had never grown to love. He did not look up. He did not have to. The step on the flagstones was familiar in the way old wounds are familiar: not because they are kind, but because they always come back.
          </span>
        </p>
      )}
    </div>
  );
}

function SelectionBubble({ top, left, onAction }) {
  // Center bubble over selection; clamp to viewport
  const width = 340;
  const clampedLeft = Math.max(24, Math.min(left - width / 2, 720 - 24));
  return (
    <div
      className="selection-bubble"
      style={{ top, left: clampedLeft, transform: "none" }}
      onMouseDown={(e) => e.preventDefault()} /* don't clear selection on click */
    >
      <button onClick={() => onAction("rewrite")}><Icons.Wand size={13}/> Rewrite</button>
      <button onClick={() => onAction("describe")}><Icons.Sparkles size={13}/> Describe</button>
      <button onClick={() => onAction("expand")}><Icons.Compass size={13}/> Expand</button>
      <div className="sep"/>
      <button onClick={() => onAction("ask")}><Icons.MessageCircle size={13}/> Ask AI</button>
    </div>
  );
}

function InlineAIResult({ aiAction, onDismiss }) {
  const [status, setStatus] = useStateEd("thinking"); // thinking | done

  useEffectEd(() => {
    setStatus("thinking");
    const t = setTimeout(() => setStatus("done"), 1400);
    return () => clearTimeout(t);
  }, [aiAction]);

  const labels = {
    rewrite: "Rewrite",
    describe: "Describe",
    expand: "Expand",
  };
  const samples = {
    rewrite: "He hauled at the handle, and the wood complained back at him — an old, arthritic creak from a churn that had drunk too many winters. Seven minutes, twenty-three seconds. His knuckles went pale. The same hands. The same grip.",
    describe: "The churn smelled of soured cream and pine sap. A ribbon of dust caught the morning light and hung there, unwilling to fall. Somewhere outside, a wood-pigeon coughed out its two-note complaint.",
    expand: "He let the rhythm take him. There was a kind of mercy in work that asked nothing but your arm. A rhythm you could lose yourself inside. It was the same mercy a whetstone gave to a blade: a job, a direction, the blank refusal to think.",
  };

  return (
    <div style={{
      marginTop: 18,
      padding: "12px 14px",
      border: "1px solid color-mix(in srgb, var(--ai) 20%, var(--line))",
      borderRadius: 6,
      background: "var(--ai-soft)",
      fontFamily: "var(--sans)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icons.Sparkles size={13} style={{ color: "var(--ai)" }}/>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ai)", textTransform: "uppercase", letterSpacing: ".06em" }}>
          {labels[aiAction.action]}
        </span>
        <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>
          {status === "thinking" ? "generating…" : "venice-uncensored · 1.4s"}
        </span>
        <span style={{ flex: 1 }}/>
        <button className="icon-btn" onClick={onDismiss} style={{ width: 22, height: 22 }}><Icons.X size={12}/></button>
      </div>

      <div style={{
        fontSize: 11.5, color: "var(--ink-4)", marginBottom: 8,
        paddingLeft: 8, borderLeft: "2px solid var(--line-2)",
        fontStyle: "italic",
        fontFamily: "var(--serif)",
      }}>
        "{aiAction.text.length > 140 ? aiAction.text.slice(0, 140) + "…" : aiAction.text}"
      </div>

      {status === "thinking" ? (
        <div style={{ display: "flex", gap: 4, padding: "6px 0" }}>
          <span className="think-dot"/>
          <span className="think-dot" style={{ animationDelay: ".15s" }}/>
          <span className="think-dot" style={{ animationDelay: ".3s" }}/>
        </div>
      ) : (
        <>
          <div style={{
            fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.6,
            color: "var(--ink)", marginBottom: 10,
          }}>
            {samples[aiAction.action]}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary" style={{ padding: "4px 10px", fontSize: 12 }}>
              <Icons.Check size={11}/> Replace
            </button>
            <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }}>
              <Icons.Plus size={11}/> Insert after
            </button>
            <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }}>
              <Icons.Refresh size={11}/> Retry
            </button>
            <span style={{ flex: 1 }}/>
            <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onDismiss}>
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ContinueAffordance({ onContinue, hasContinuation }) {
  if (hasContinuation) {
    return (
      <div style={{
        display: "flex", gap: 8, marginTop: 16, alignItems: "center",
        padding: "10px 14px", background: "var(--ai-soft)",
        border: "1px solid color-mix(in srgb, var(--ai) 15%, transparent)",
        borderRadius: 6, fontSize: 12.5, fontFamily: "var(--sans)",
      }}>
        <Icons.Sparkles size={14} style={{ color: "var(--ai)" }}/>
        <span style={{ color: "var(--ai)", fontWeight: 500 }}>AI continuation · 58 words</span>
        <span style={{ color: "var(--ink-4)", flex: 1 }}>Generated by venice-uncensored · 2s ago</span>
        <button className="btn ghost" style={{ padding: "3px 8px", fontSize: 11.5 }}>Keep</button>
        <button className="btn ghost" style={{ padding: "3px 8px", fontSize: 11.5 }}><Icons.Refresh size={11}/> Retry</button>
        <button className="btn ghost" style={{ padding: "3px 8px", fontSize: 11.5 }}>Discard</button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 24, display: "flex", gap: 8, alignItems: "center", fontFamily: "var(--sans)" }}>
      <button
        onClick={onContinue}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", fontSize: 12.5, color: "var(--ai)",
          border: "1px dashed color-mix(in srgb, var(--ai) 30%, var(--line-2))",
          borderRadius: 20, background: "transparent",
          fontFamily: "var(--sans)", cursor: "pointer",
        }}
      >
        <Icons.Sparkles size={13}/> Continue writing
      </button>
      <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>
        ⌥↵ &nbsp; generates ~80 words in your voice
      </span>
    </div>
  );
}

window.Editor = Editor;
