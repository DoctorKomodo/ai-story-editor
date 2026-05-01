// [F43] Settings modal — 720px centered dialog with a Venice tab,
// faithful to mockups/frontend-prototype/design/modals.jsx (`SettingsModal`
// + `VeniceSection`). The Models / Writing / Appearance tabs are stubs
// owned by F44 / F45 / F46 — F43 ships only the shell + Venice.
//
// Self-hosting tab is intentionally omitted (stakeholder direction, see
// task brief). Auto-save semantics: each form field fires its mutation on
// change; the footer's Cancel / Done both just close the modal.
//
// [X22] Ported onto the `<Modal>` primitive — backdrop, Escape, click-outside,
// and focus-trap chrome all live in the primitive now. The tab strip is
// inlined as a direct child between <ModalHeader> and <ModalBody> rather than
// extracted into a <ModalTabbed> primitive — Settings is the only multi-tab
// modal in the app (the other role="tablist" usages live in Sidebar /
// ChatPanel / ChatComposer, not modals).
import type { JSX } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { SettingsAppearanceTab } from '@/components/SettingsAppearanceTab';
import { SettingsModelsTab } from '@/components/SettingsModelsTab';
import { SettingsWritingTab } from '@/components/SettingsWritingTab';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@/design/primitives';
import { useUpdateUserSettingsMutation, useUserSettingsQuery } from '@/hooks/useUserSettings';
import {
  useDeleteVeniceKeyMutation,
  useStoreVeniceKeyMutation,
  useVeniceKeyStatusQuery,
  useVerifyVeniceKeyMutation,
  type VeniceKeyVerify,
} from '@/hooks/useVeniceKey';

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = 'venice' | 'models' | 'writing' | 'appearance';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'venice', label: 'Venice.ai' },
  { id: 'models', label: 'Models' },
  { id: 'writing', label: 'Writing' },
  { id: 'appearance', label: 'Appearance' },
];

function EyeIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 4.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.86 19.86 0 0 1-3.17 4.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function SettingsModal({ open, onClose }: SettingsModalProps): JSX.Element | null {
  const titleId = useId();
  const [activeTab, setActiveTab] = useState<SettingsTab>('venice');

  // Reset to Venice tab whenever the modal re-opens — avoids stale tab
  // state bleeding across opens.
  useEffect(() => {
    if (open) setActiveTab('venice');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      size="xl"
      testId="settings-modal"
      backdropTestId="settings-backdrop"
    >
      <ModalHeader
        titleId={titleId}
        title="Settings"
        subtitle="Configure Venice.ai integration, writing preferences, and self-hosting"
        onClose={onClose}
        closeTestId="settings-close"
      />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="px-[18px] border-b border-line flex gap-1 flex-shrink-0"
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`settings-panel-${tab.id}`}
              id={`settings-tab-${tab.id}`}
              data-testid={`settings-tab-${tab.id}`}
              onClick={() => {
                setActiveTab(tab.id);
              }}
              className={[
                'relative px-3 py-2 text-[13px] font-sans transition-colors',
                active
                  ? 'text-ink after:absolute after:left-0 after:right-0 after:-bottom-px after:h-px after:bg-ink'
                  : 'text-ink-3 hover:text-ink',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <ModalBody
        className="flex-1 overflow-y-auto p-4"
        role="tabpanel"
        id={`settings-panel-${activeTab}`}
        aria-labelledby={`settings-tab-${activeTab}`}
        data-testid={`settings-panel-${activeTab}`}
      >
        {activeTab === 'venice' ? (
          <VeniceTab />
        ) : activeTab === 'models' ? (
          <SettingsModelsTab />
        ) : activeTab === 'writing' ? (
          <SettingsWritingTab />
        ) : (
          <SettingsAppearanceTab />
        )}
      </ModalBody>

      <ModalFooter
        leading={
          <span data-testid="settings-autosave-hint">
            Changes save automatically to your local vault
          </span>
        }
      >
        <Button variant="ghost" data-testid="settings-cancel" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" data-testid="settings-done" onClick={onClose}>
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// --- Venice tab ---------------------------------------------------------

interface VerifyPillState {
  kind: 'idle' | 'ok' | 'err';
  message: string;
}

function VeniceTab(): JSX.Element {
  const apiKeyId = useId();
  const endpointId = useId();
  const orgId = useId();

  const statusQuery = useVeniceKeyStatusQuery();
  const settingsQuery = useUserSettingsQuery();
  const storeMutation = useStoreVeniceKeyMutation();
  const deleteMutation = useDeleteVeniceKeyMutation();
  const verifyMutation = useVerifyVeniceKeyMutation();
  const updateSettings = useUpdateUserSettingsMutation();

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [endpointDraft, setEndpointDraft] = useState('');
  const [organizationDraft, setOrganizationDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [verifyPill, setVerifyPill] = useState<VerifyPillState>({ kind: 'idle', message: '' });

  // Seed the endpoint field from the latest server status — but only when
  // the user hasn't started editing it yet (don't trample drafts).
  const seededEndpointRef = useRef(false);
  useEffect(() => {
    if (seededEndpointRef.current) return;
    const ep = statusQuery.data?.endpoint;
    if (typeof ep === 'string' && ep.length > 0) {
      setEndpointDraft(ep);
      seededEndpointRef.current = true;
    }
  }, [statusQuery.data?.endpoint]);

  const status = statusQuery.data;
  const lastFour = status?.lastFour ?? null;

  const handleSave = async (): Promise<void> => {
    if (apiKeyDraft.trim().length === 0) return;
    setVerifyPill({ kind: 'idle', message: '' });
    try {
      await storeMutation.mutateAsync({
        apiKey: apiKeyDraft,
        endpoint: endpointDraft.trim().length > 0 ? endpointDraft.trim() : undefined,
        organization: organizationDraft.trim().length > 0 ? organizationDraft.trim() : undefined,
      });
      // Clear the plaintext draft immediately — never keep it sitting in
      // component state once the server has acknowledged storage.
      setApiKeyDraft('');
    } catch {
      // Mutation error state is rendered via `storeMutation.isError` below.
    }
  };

  const handleVerify = async (): Promise<void> => {
    try {
      const res: VeniceKeyVerify = await verifyMutation.mutateAsync();
      if (res.verified) {
        const credits = res.credits != null ? res.credits.toLocaleString() : '—';
        setVerifyPill({ kind: 'ok', message: `Verified · ${credits} credits` });
      } else {
        const four = res.lastFour ?? lastFour ?? '????';
        setVerifyPill({ kind: 'err', message: `Not verified · last four ${four}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setVerifyPill({ kind: 'err', message: msg });
    }
  };

  const handleRemove = async (): Promise<void> => {
    setVerifyPill({ kind: 'idle', message: '' });
    try {
      await deleteMutation.mutateAsync();
      setApiKeyDraft('');
    } catch {
      // surfaced via mutation error state below
    }
  };

  const includeVeniceSystemPrompt = settingsQuery.data?.ai.includeVeniceSystemPrompt ?? true;

  const handleToggleVenicePrompt = (next: boolean): void => {
    if (!settingsQuery.data) return;
    updateSettings.mutate({ ai: { includeVeniceSystemPrompt: next } });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="venice-section-connection">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Connection</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Your API key is stored encrypted on the server and only ever used to call Venice.ai on
            your behalf.
          </p>
        </header>

        <div className="flex flex-col gap-1">
          <label htmlFor={apiKeyId} className="flex items-baseline justify-between text-[12px]">
            <span className="font-medium text-ink-2">API Key</span>
            <span className="text-ink-4 font-sans">
              {status?.hasKey && lastFour ? (
                <span data-testid="venice-key-last-four">
                  Stored: <span aria-hidden="true">••••</span> {lastFour}
                </span>
              ) : (
                <>From venice.ai → Settings → API</>
              )}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id={apiKeyId}
              data-testid="venice-key-input"
              type={showKey ? 'text' : 'password'}
              value={apiKeyDraft}
              autoComplete="off"
              spellCheck={false}
              placeholder={status?.hasKey ? 'Enter a new key to replace' : 'vn_…'}
              onChange={(e) => {
                setApiKeyDraft(e.target.value);
              }}
              className="flex-1 px-3 py-2 text-[13px] font-mono border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              data-testid="venice-key-eye"
              onClick={() => {
                setShowKey((v) => !v);
              }}
            >
              {showKey ? <EyeOffIcon /> : <EyeIcon />}
            </button>
            <button
              type="button"
              data-testid="venice-key-save"
              disabled={apiKeyDraft.trim().length === 0 || storeMutation.isPending}
              onClick={() => {
                void handleSave();
              }}
              className="px-3 py-1.5 text-[12px] rounded-[var(--radius)] bg-ink text-bg hover:bg-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {storeMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              data-testid="venice-key-verify"
              disabled={!status?.hasKey || verifyMutation.isPending}
              onClick={() => {
                void handleVerify();
              }}
              className="px-3 py-1.5 text-[12px] border border-line rounded-[var(--radius)] text-ink-2 hover:bg-[var(--surface-hover)] hover:text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              data-testid="venice-key-remove"
              disabled={!status?.hasKey || deleteMutation.isPending}
              onClick={() => {
                void handleRemove();
              }}
              className="px-3 py-1.5 text-[12px] border border-line rounded-[var(--radius)] text-[color:var(--danger)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleteMutation.isPending ? 'Removing…' : 'Remove'}
            </button>
          </div>

          {verifyPill.kind !== 'idle' ? (
            <span
              role="status"
              data-testid="venice-key-pill"
              data-pill={verifyPill.kind}
              className={[
                'mt-1 inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono',
                verifyPill.kind === 'ok'
                  ? 'bg-[color-mix(in_srgb,#6aa84f_16%,transparent)] text-[#3e6e2a]' /* lint:design-allow — one-off success-pill green; no --success token in the system yet. */
                  : 'bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[color:var(--danger)]',
              ].join(' ')}
            >
              {verifyPill.message}
            </span>
          ) : null}

          {storeMutation.isError ? (
            <span
              role="alert"
              data-testid="venice-key-save-error"
              className="text-[11px] font-mono text-[color:var(--danger)]"
            >
              {storeMutation.error instanceof Error
                ? storeMutation.error.message
                : 'Failed to save key.'}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={endpointId} className="flex items-baseline justify-between text-[12px]">
            <span className="font-medium text-ink-2">Endpoint</span>
            <span className="text-ink-4 font-sans">Override for self-hosted proxies</span>
          </label>
          <input
            id={endpointId}
            data-testid="venice-endpoint-input"
            type="text"
            value={endpointDraft}
            placeholder="https://api.venice.ai/api/v1"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setEndpointDraft(e.target.value);
              seededEndpointRef.current = true;
            }}
            className="px-3 py-2 text-[13px] font-mono border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={orgId} className="flex items-baseline justify-between text-[12px]">
            <span className="font-medium text-ink-2">Organization</span>
            <span className="text-ink-4 font-sans">Optional — for team accounts</span>
          </label>
          <input
            id={orgId}
            data-testid="venice-org-input"
            type="text"
            value={organizationDraft}
            placeholder="(none)"
            autoComplete="off"
            onChange={(e) => {
              setOrganizationDraft(e.target.value);
            }}
            className="px-3 py-2 text-[13px] font-sans border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
          />
        </div>
      </section>

      {/* [F67] The Features + Privacy sections were removed — every toggle was
          stateful but no-op. The Include-Venice-system-prompt toggle (the one
          actually wired through settings.ai.includeVeniceSystemPrompt) lives
          in its own Behaviour section. */}
      <section className="flex flex-col gap-3" data-testid="venice-section-behaviour">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Behaviour</h3>
        </header>

        <label className="flex items-start gap-2 text-[12px] py-1">
          <input
            type="checkbox"
            data-testid="venice-include-system-prompt"
            checked={includeVeniceSystemPrompt}
            disabled={!settingsQuery.data || updateSettings.isPending}
            onChange={(e) => {
              handleToggleVenicePrompt(e.target.checked);
            }}
            className="mt-1"
          />
          <span className="flex flex-col gap-[2px]">
            <span className="font-medium text-ink-2">Include Venice creative-writing prompt</span>
            <span className="text-ink-4 font-sans">
              Prepend Venice&apos;s built-in creative writing guidance on top of Inkwell&apos;s own
              system prompt.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
