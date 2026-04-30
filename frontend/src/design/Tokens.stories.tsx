import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef } from 'react';

// Token list — keep in sync with frontend/src/index.css. If you add a
// token to the @theme block or :root, also add it here. There is no
// auto-discovery (intentional: the story is the public surface, not a
// dump of every CSS variable).

const COLOR_TOKENS: { group: string; names: string[] }[] = [
  { group: 'Surface', names: ['--bg', '--bg-elevated', '--bg-sunken', '--surface-hover'] },
  { group: 'Ink', names: ['--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5'] },
  { group: 'Lines', names: ['--line', '--line-2'] },
  {
    group: 'Accent',
    names: ['--accent', '--accent-soft', '--mark', '--selection', '--ai', '--ai-soft', '--danger'],
  },
  { group: 'Backdrop', names: ['--color-backdrop'] },
];

const TYPE_TOKENS = ['--sans', '--serif', '--mono'] as const;
const RADIUS_TOKENS = ['--radius', '--radius-lg'] as const;
const SHADOW_TOKENS = ['--shadow-card', '--shadow-pop'] as const;

function Swatches() {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root.current) return;
    const cs = getComputedStyle(document.documentElement);
    root.current.querySelectorAll<HTMLElement>('[data-hex]').forEach((el) => {
      const name = el.dataset.hex;
      if (name) el.textContent = cs.getPropertyValue(name).trim();
    });
    root.current.querySelectorAll<HTMLElement>('[data-font]').forEach((el) => {
      const name = el.dataset.font;
      if (name) el.textContent = cs.getPropertyValue(name).trim().split(',')[0];
    });
    root.current.querySelectorAll<HTMLElement>('[data-css]').forEach((el) => {
      const name = el.dataset.css;
      if (name) el.textContent = cs.getPropertyValue(name).trim();
    });
  });

  return (
    <div ref={root} style={{ display: 'grid', gap: 32, fontFamily: 'var(--mono)' }}>
      {COLOR_TOKENS.map(({ group, names }) => (
        <section key={group}>
          <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>
            {group}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {names.map((n) => (
              <div key={n} style={{ border: '1px solid var(--line)', borderRadius: 3 }}>
                <div style={{ background: `var(${n})`, height: 60, borderRadius: '3px 3px 0 0' }} />
                <div style={{ padding: '6px 8px', fontSize: 11 }}>
                  <div style={{ color: 'var(--ink)' }}>{n}</div>
                  <div data-hex={n} style={{ color: 'var(--ink-3)' }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>
          Type
        </h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {TYPE_TOKENS.map((n) => (
            <div key={n} style={{ border: '1px solid var(--line)', borderRadius: 3, padding: 12 }}>
              <div style={{ font: '600 11px var(--mono)', color: 'var(--ink-3)' }}>
                {n} — <span data-font={n} />
              </div>
              <div
                style={{
                  fontFamily: `var(${n})`,
                  fontSize: 18,
                  color: 'var(--ink)',
                  marginTop: 6,
                }}
              >
                The quick brown fox jumps over the lazy dog
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>
          Radius
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {RADIUS_TOKENS.map((n) => (
            <div key={n} style={{ border: '1px solid var(--line)', borderRadius: 3, padding: 12 }}>
              <div
                style={{
                  background: 'var(--bg-sunken)',
                  border: '1px solid var(--line-2)',
                  height: 60,
                  borderRadius: `var(${n})`,
                }}
              />
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink)' }}>{n}</div>
              <div data-css={n} style={{ fontSize: 11, color: 'var(--ink-3)' }} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>
          Shadow
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {SHADOW_TOKENS.map((n) => (
            <div key={n} style={{ padding: 12 }}>
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  height: 80,
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: `var(${n})`,
                }}
              />
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink)' }}>{n}</div>
              <div
                data-css={n}
                style={{
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta = { title: 'Tokens/Swatches', component: Swatches } satisfies Meta<typeof Swatches>;
export default meta;
export const All: StoryObj<typeof meta> = {};
