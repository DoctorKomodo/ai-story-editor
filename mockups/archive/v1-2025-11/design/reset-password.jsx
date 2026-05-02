// Reset-password screen — reached via "Forgot password?" on the login page.
// Reuses .auth-screen / .auth-hero from auth.jsx; the right-pane card is
// the recovery-code input + new password.

function ResetPasswordScreen({ onSubmit }) {
  const [username, setUsername] = React.useState("");
  const [recoveryCode, setRecoveryCode] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = (e) => {
    e.preventDefault();
    setError("");
    if (!username.trim()) return setError("Username required.");
    if (!recoveryCode.trim()) return setError("Recovery code required.");
    if (newPassword.length < 8) return setError("Password must be at least 8 characters.");
    if (newPassword !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setTimeout(() => { setBusy(false); onSubmit(); }, 600);
  };

  return (
    <div className="auth-screen">
      <aside className="auth-hero">
        <div className="auth-brand">
          <FeatherIcon />
          <span>Inkwell</span>
        </div>
        <blockquote className="auth-quote">
          "If you have your recovery code, your stories are still yours."
          <cite>— inkwell handbook</cite>
        </blockquote>
        <div className="auth-foot">
          <span>Self-hosted · v0.4.2</span>
        </div>
      </aside>

      <div className="auth-pane">
        <form className="auth-card" onSubmit={submit}>
          <h1 className="auth-title">Reset your password</h1>
          <p className="auth-sub">
            Use the recovery code we showed you at signup to set a new password.
            All other sessions will be signed out.
          </p>

          <Field label="Username">
            <input className="text-input" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoFocus />
          </Field>

          <Field label="Recovery code" hint="The code we showed you at signup. Spaces and line breaks are fine.">
            <textarea className="text-input mono" rows="3" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
          </Field>

          <Field label="New password">
            <div className="pw-row">
              <input className="text-input" type={showPw ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button type="button" className="icon-btn" onClick={() => setShowPw(v => !v)}>{showPw ? <EyeOffIcon /> : <EyeIcon />}</button>
            </div>
          </Field>

          <Field label="Confirm new password">
            <input className="text-input" type={showPw ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? <span className="auth-spinner" /> : null}
            <span>Reset password</span>
          </button>

          <p className="auth-link-row">
            <a href="/login">Back to sign in</a>
          </p>
        </form>
      </div>
    </div>
  );
}
