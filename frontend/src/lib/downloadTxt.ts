// [F20] Trigger a client-side .txt download.
//
// Not mockup-fidelity — this is a utility. Creates a Blob with a UTF-8 MIME
// type, wires it to a hidden <a download> element, dispatches a click, then
// cleans up (removes the element + revokes the object URL). SSR-safe: no-ops
// if `document` is undefined.

export function downloadTxt(filename: string, content: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Hidden — we only need it long enough to receive the click.
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
