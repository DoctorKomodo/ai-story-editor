// CharRef @-trigger menu — appears below the caret when the user types `@`
// in the editor and starts narrowing by typed query. Mirrors the styling
// of other Inkwell popovers (paper-card surface, 1px line, soft shadow).

function CharRefMenu({ items, activeIndex, query, x, y }) {
  if (items.length === 0) {
    return (
      <div className="char-ref-menu" style={{ position: "fixed", left: x, top: y }}>
        <p className="char-ref-empty">No characters in this story yet.</p>
      </div>
    );
  }
  return (
    <ul
      className="char-ref-menu"
      role="listbox"
      aria-label="Characters"
      style={{ position: "fixed", left: x, top: y }}
    >
      {items.map((c, i) => (
        <li
          key={c.id}
          role="option"
          id={`charref-opt-${c.id}`}
          aria-selected={i === activeIndex}
          className={`char-ref-item ${i === activeIndex ? "active" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="char-ref-name">{highlight(c.name, query)}</span>
          {c.role && <span className="char-ref-role">{c.role}</span>}
        </li>
      ))}
    </ul>
  );
}

function highlight(name, query) {
  if (!query) return name;
  const i = name.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + query.length)}</mark>
      {name.slice(i + query.length)}
    </>
  );
}
