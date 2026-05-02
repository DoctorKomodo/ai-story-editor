// Login / signup screen
const { useState: useStateAuth } = React;

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useStateAuth("login"); // login | signup
  const [name, setName] = useStateAuth("");
  const [username, setUsername] = useStateAuth("");
  const [password, setPassword] = useStateAuth("");
  const [showPw, setShowPw] = useStateAuth(false);
  const [error, setError] = useStateAuth("");
  const [busy, setBusy] = useStateAuth(false);

  const submit = (e) => {
    e.preventDefault();
    setError("");
    if (mode === "signup" && !name.trim()) return setError("Please enter your name.");
    if (!username.trim()) return setError("Username required.");
    if (password.length < 4) return setError("Password must be at least 4 characters.");
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onAuth({
        name: mode === "signup" ? name.trim() : "Elena Marsh",
        username: username.trim(),
      });
    }, 600);
  };

  return (
    <div className="auth-screen">
      <div className="auth-hero">
        <div className="auth-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
            <line x1="16" y1="8" x2="2" y2="22"/>
            <line x1="17.5" y1="15" x2="9" y2="15"/>
          </svg>
          <span>Inkwell</span>
        </div>
        <blockquote className="auth-quote">
          "A story is a letter the writer writes to themself, to tell themself things they would be unable to confront in plain speech."
          <cite>— stray marginalia</cite>
        </blockquote>
        <div className="auth-foot">
          <span>Self-hosted · v0.4.2</span>
          <span>·</span>
          <span>inkwell-01</span>
        </div>
      </div>

      <div className="auth-pane">
        <form className="auth-card" onSubmit={submit}>
          <h1 className="auth-title">
            {mode === "login" ? "Welcome back" : "Create an account"}
          </h1>
          <p className="auth-sub">
            {mode === "login"
              ? "Sign in to continue your stories."
              : "A single account holds all your drafts, chapters, and characters."}
          </p>

          {mode === "signup" && (
            <Field label="Name" hint="Shown on your stories. Can be a pen name.">
              <input
                className="text-input sans"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Elena Marsh"
                autoFocus
              />
            </Field>
          )}

          <Field label="Username" hint={mode === "signup" ? "Used to sign in. Lowercase, no spaces." : ""}>
            <input
              className="text-input"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
              placeholder="elena"
              autoFocus={mode === "login"}
              autoComplete="username"
            />
          </Field>

          <Field label="Password">
            <div style={{ display: "flex", gap: 6, flex: 1 }}>
              <input
                className="text-input"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                style={{ flex: 1 }}
              />
              <button type="button" className="icon-btn" onClick={() => setShowPw(v => !v)} title={showPw ? "Hide" : "Show"}>
                {showPw ? <Icons.EyeOff size={14}/> : <Icons.Eye size={14}/>}
              </button>
            </div>
          </Field>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn primary auth-submit" disabled={busy}>
            {busy
              ? <><span className="spinner"/> {mode === "login" ? "Signing in…" : "Creating account…"}</>
              : <>{mode === "login" ? "Sign in" : "Create account"} <Icons.ArrowRight size={13}/></>
            }
          </button>

          <div className="auth-switch">
            {mode === "login" ? (
              <>First time here? <button type="button" onClick={() => { setMode("signup"); setError(""); }}>Create an account</button></>
            ) : (
              <>Already have an account? <button type="button" onClick={() => { setMode("login"); setError(""); }}>Sign in</button></>
            )}
          </div>

          <div className="auth-meta">
            <Icons.Shield size={11}/>
            <span>Authenticated against your self-hosted Inkwell server.</span>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="auth-field">
      <span className="auth-label">
        {label}
        {hint && <span className="auth-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

window.AuthScreen = AuthScreen;
