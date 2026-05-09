import type { JSX } from 'react';

export function SceneEmptyState(): JSX.Element {
  return (
    <div className="m-auto flex flex-col items-center gap-3 text-center" data-testid="scene-empty">
      <div className="font-serif italic text-[15px] text-ink-3 max-w-[280px]">
        Describe what happens next — a scene, a beat, an action — and the assistant will draft it in
        your voice.
      </div>
      <div className="text-[11px] font-mono text-ink-4">
        Try: &ldquo;Jenny approaches Linda on the veranda and they talk about cheese.&rdquo;
      </div>
    </div>
  );
}
