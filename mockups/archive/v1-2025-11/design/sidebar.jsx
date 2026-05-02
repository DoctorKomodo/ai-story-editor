// Sidebar — stories / chapters / characters / outline
const { useState } = React;

function Sidebar({ story, activeTab, setActiveTab, activeChapter, setActiveChapter, onOpenChar, onOpenStoryPicker }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button className="story-picker" onClick={onOpenStoryPicker}>
          <Icons.Book size={14} style={{ color: "var(--ink-3)" }}/>
          <span className="title">{story.title}</span>
          <Icons.ChevronDown size={12} className="chev"/>
        </button>
        <button className="icon-btn" title="New">
          <Icons.Plus size={14}/>
        </button>
      </div>

      <div className="sidebar-tabs">
        <button className={`sidebar-tab ${activeTab === "chapters" ? "active" : ""}`} onClick={() => setActiveTab("chapters")}>
          Chapters <span className="count">{story.chapters.length}</span>
        </button>
        <button className={`sidebar-tab ${activeTab === "cast" ? "active" : ""}`} onClick={() => setActiveTab("cast")}>
          Cast <span className="count">{story.characters.length}</span>
        </button>
        <button className={`sidebar-tab ${activeTab === "outline" ? "active" : ""}`} onClick={() => setActiveTab("outline")}>
          Outline
        </button>
      </div>

      <div className="sidebar-body">
        {activeTab === "chapters" && <ChapterList story={story} active={activeChapter} setActive={setActiveChapter}/>}
        {activeTab === "cast" && <CastList story={story} onOpenChar={onOpenChar}/>}
        {activeTab === "outline" && <OutlineList story={story}/>}
      </div>

      <StoryProgress story={story}/>
    </aside>
  );
}

function ChapterList({ story, active, setActive }) {
  return (
    <div>
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Manuscript</span>
          <button className="add" title="New chapter"><Icons.Plus size={12}/></button>
        </div>
        {story.chapters.map(ch => (
          <div
            key={ch.id}
            className={`chapter-item ${active === ch.id ? "active" : ""}`}
            onClick={() => setActive(ch.id)}
          >
            <span className="num">{String(ch.num).padStart(2, "0")}</span>
            <span className="ch-title">{ch.title}</span>
            <span className="ch-wc">{ch.words > 0 ? (ch.words >= 1000 ? (ch.words/1000).toFixed(1)+"k" : ch.words) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CastList({ story, onOpenChar }) {
  const principal = story.characters.slice(0, 2);
  const supporting = story.characters.slice(2);
  return (
    <>
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Principal</span>
          <button className="add"><Icons.Plus size={12}/></button>
        </div>
      </div>
      {principal.map(c => <CharCard key={c.id} char={c} onClick={() => onOpenChar(c)}/>)}

      <div className="sidebar-section" style={{marginTop: 10}}>
        <div className="sidebar-section-header">
          <span>Supporting</span>
          <button className="add"><Icons.Plus size={12}/></button>
        </div>
      </div>
      {supporting.map(c => <CharCard key={c.id} char={c} onClick={() => onOpenChar(c)}/>)}
    </>
  );
}

function CharCard({ char, onClick }) {
  return (
    <div className="char-card" onClick={onClick}>
      <div className="char-avatar" style={{ background: char.color }}>{char.initial}</div>
      <div className="char-info">
        <div className="char-name">{char.name}</div>
        <div className="char-role">{char.role} · {char.age}</div>
      </div>
    </div>
  );
}

function OutlineList({ story }) {
  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <span>Story Arc</span>
        <button className="add"><Icons.Plus size={12}/></button>
      </div>
      {story.outline.map(o => (
        <div key={o.id} className={`outline-item ${o.status}`}>
          <div>{o.title}</div>
          <div className="sub">{o.sub}</div>
        </div>
      ))}
    </div>
  );
}

function StoryProgress({ story }) {
  const pct = Math.round((story.wordCount / story.targetWords) * 100);
  return (
    <div style={{
      padding: "10px 14px",
      borderTop: "1px solid var(--line)",
      fontFamily: "var(--mono)",
      fontSize: 10.5,
      color: "var(--ink-4)",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{story.wordCount.toLocaleString()} / {story.targetWords.toLocaleString()} words</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 2, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--ink-3)" }}/>
      </div>
    </div>
  );
}

window.Sidebar = Sidebar;
