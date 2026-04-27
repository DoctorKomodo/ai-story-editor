// Recovery-code handoff — shown immediately after successful signup.
// Full-screen, no app chrome (the user is not yet logged in to the SPA).
// Mirrors the .auth-screen split layout but the right pane is the handoff card.

function RecoveryCodeHandoff({ recoveryCode, username, onContinue }) {
  const [copied, setCopied] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob(
      [`Inkwell recovery code\nUsername: ${username}\nRecovery code: ${recoveryCode}\n\nKeep this somewhere safe. Without it AND your password, your encrypted stories cannot be recovered.\n`],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inkwell-recovery-code-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="auth-screen">
      <aside className="auth-hero">
        <div className="auth-brand">
          <FeatherIcon />
          <span>Inkwell</span>
        </div>
        <blockquote className="auth-quote">
          "Keep this code somewhere only you can reach. It is the second of two
          locks on your stories — your password is the first."
          <cite>— inkwell handbook</cite>
        </blockquote>
        <div className="auth-foot">
          <span>Self-hosted · v0.4.2</span>
          <span>·</span>
          <span>inkwell-01</span>
        </div>
      </aside>

      <div className="auth-pane">
        <div className="recovery-code-card">
          <h1 className="auth-title">Save your recovery code</h1>
          <p className="auth-sub">
            This is the only thing that can unlock your stories if you forget your
            password. We will not show it again.
          </p>

          <div className="recovery-code-warning" role="note">
            <strong>Show once.</strong> Inkwell does not store this anywhere it can
            read. Lose your password and this code, and your stories are gone for good.
          </div>

          <div className="recovery-code-box" data-testid="recovery-code-box">
            <code>{recoveryCode}</code>
          </div>

          <div className="recovery-code-actions">
            <button type="button" className="btn-secondary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="btn-secondary" onClick={download}>
              Download as .txt
            </button>
          </div>

          <label className="recovery-code-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>I have stored my recovery code somewhere safe.</span>
          </label>

          <button
            type="button"
            disabled={!confirmed}
            className="btn-primary"
            onClick={onContinue}
          >
            Continue to Inkwell
          </button>
        </div>
      </div>
    </div>
  );
}
