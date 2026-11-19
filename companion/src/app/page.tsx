"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Phase = "loading" | "setup" | "login" | "console";
interface Token { id: string; name: string; prefix: string; scopes: string[]; rateLimitPerMin: number; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
interface MeetingRow { id: string; title: string; startedAt: string; durationSec: number; summary: string | null }

const TOOLS: [string, string][] = [
  ["search_meetings", "Ranked full-text search, optional date range; hits include the transcript timestamp."],
  ["get_meeting", "One meeting: summary, decisions, actions, open questions, optional transcript."],
  ["list_decisions", "Decisions across meetings, filterable by topic and date, each with its source."],
  ["list_action_items", "Action items; owner and deadline only if the meeting stated them."],
  ["generate_report", "Deterministic markdown report for a meeting. No model, nothing invented."],
];

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

export default function Page() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    const { data } = await api<{ configured: boolean; authenticated: boolean }>("/api/owner/state");
    setPhase(!data.configured ? "setup" : data.authenticated ? "console" : "login");
  }, []);
  useEffect(() => { void refreshState(); }, [refreshState]);

  return (
    <main className="mx-auto max-w-[880px] px-6 pb-24 pt-14">
      <header className="mb-14 flex items-end justify-between">
        <div>
          <p className="eyebrow">Companion · self-hosted</p>
          <h1 className="serif m-0 mt-2 text-[44px] leading-none">MeetDolff</h1>
        </div>
        {phase === "console" && (
          <button className="btn btn-quiet" onClick={async () => { await api("/api/owner/logout", { method: "POST" }); setError(null); await refreshState(); }}>
            Sign out
          </button>
        )}
      </header>

      <div role="alert" aria-live="assertive">
        {error && <p className="mb-6 border border-[var(--danger)] px-3 py-2 text-[13px] text-[var(--danger)]">{error}</p>}
      </div>

      {phase === "loading" && <p className="text-[var(--muted)]">Loading…</p>}
      {(phase === "setup" || phase === "login") && <Gate phase={phase} onDone={refreshState} setError={setError} />}
      {phase === "console" && <Console setError={setError} />}
    </main>
  );
}

function Gate({ phase, onDone, setError }: { phase: "setup" | "login"; onDone: () => Promise<void>; setError: (e: string | null) => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const setup = phase === "setup";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await api(setup ? "/api/owner/setup" : "/api/owner/login", { method: "POST", body: JSON.stringify({ passphrase: pass }) });
    setBusy(false);
    if (!r.ok) return setError(r.data.error ?? "Something went wrong.");
    setPass("");
    await onDone();
  }
  return (
    <section className="max-w-[520px]">
      <h2 className="serif m-0 text-[28px] leading-tight">{setup ? "Claim this companion" : "Welcome back"}</h2>
      <p className="mt-3 text-[var(--muted)]">
        {setup
          ? "Your meeting memory stays on a server you control. Choose a passphrase to claim it — the first person to do this becomes the only owner, so do it now and keep this deployment private until you have."
          : "Enter your owner passphrase to manage agent access."}
      </p>
      <form onSubmit={submit} className="mt-6 grid gap-3">
        <label className="eyebrow" htmlFor="pass">{setup ? "New passphrase (12+ characters)" : "Passphrase"}</label>
        <input id="pass" className="field" type="password" autoComplete={setup ? "new-password" : "current-password"} value={pass} onChange={(e) => setPass(e.target.value)} required minLength={setup ? 12 : 1} />
        <div><button className="btn btn-solid" disabled={busy}>{busy ? "Working…" : setup ? "Claim companion" : "Sign in"}</button></div>
      </form>
    </section>
  );
}

function Console({ setError }: { setError: (e: string | null) => void }) {
  const [origin, setOrigin] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [canSync, setCanSync] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, m] = await Promise.all([api<{ tokens: Token[] }>("/api/owner/tokens"), api<{ meetings: MeetingRow[] }>("/api/owner/meetings")]);
    if (t.ok) setTokens(t.data.tokens);
    if (m.ok) setMeetings(m.data.meetings);
  }, []);
  useEffect(() => { setOrigin(window.location.origin); void load(); }, [load]);

  async function createToken(e: FormEvent) {
    e.preventDefault(); setError(null); setFresh(null);
    const scopes = canSync ? ["memory:read", "memory:sync"] : ["memory:read"];
    const r = await api<{ token: string }>("/api/owner/tokens", { method: "POST", body: JSON.stringify({ name, scopes }) });
    if (!r.ok) return setError(r.data.error ?? "Could not create token.");
    setFresh(r.data.token); setName(""); setCanSync(false); await load();
  }

  async function revoke(t: Token) {
    if (!confirm(`Revoke “${t.name}”? Any agent using it loses access immediately.`)) return;
    const r = await api(`/api/owner/tokens/${t.id}`, { method: "DELETE" });
    if (!r.ok) setError(r.data.error ?? "Could not revoke."); else await load();
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null); setStatus(null);
    const records: unknown[] = [];
    try {
      for (const f of Array.from(files)) {
        const parsed: unknown = JSON.parse(await f.text());
        const list = Array.isArray(parsed) ? parsed : (parsed as { meetings?: unknown }).meetings;
        // index.json lists meetings without transcripts; only full meeting records are importable.
        if (Array.isArray(list)) records.push(...list); else records.push(parsed);
      }
    } catch { return setError("One of the files is not valid JSON."); }
    const r = await api<{ saved: number }>("/api/sync", { method: "POST", body: JSON.stringify({ meetings: records }) });
    if (!r.ok) return setError(r.data.error ?? "Import failed.");
    setStatus(`Imported ${r.data.saved} meeting${r.data.saved === 1 ? "" : "s"}.`); await load();
  }

  async function removeMeeting(m: MeetingRow) {
    if (!confirm(`Remove “${m.title}” from this companion? Your extension's copy is not affected.`)) return;
    await api(`/api/owner/meetings?id=${encodeURIComponent(m.id)}`, { method: "DELETE" }); await load();
  }

  const endpoint = `${origin}/api/mcp`;
  const curl = `curl -s ${endpoint} \\\n  -H "Authorization: Bearer $MEETDOLFF_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_meetings","arguments":{"query":"database performance"}}}'`;
  const config = JSON.stringify({ mcpServers: { meetdolff: { type: "http", url: endpoint, headers: { Authorization: "Bearer <your token>" } } } }, null, 2);

  return (
    <div className="grid gap-16">
      <section aria-labelledby="h-connect">
        <p className="eyebrow">01 · Connect</p>
        <h2 id="h-connect" className="serif m-0 mt-2 text-[28px]">Point an agent at your memory</h2>
        <p className="mt-3 max-w-[620px] text-[var(--muted)]">Any MCP client that supports HTTP servers can read your meetings with a token below. Access is read-only; there is no tool that changes your data.</p>
        <div className="mt-5 grid gap-3">
          <pre className="code" aria-label="MCP client configuration">{config}</pre>
          <pre className="code" aria-label="Test with curl">{curl}</pre>
        </div>
        <ul className="mt-6 m-0 list-none p-0">
          {TOOLS.map(([n, d]) => (
            <li key={n} className="rule grid gap-1 py-3 sm:grid-cols-[200px_1fr]"><span className="mono text-[13px]">{n}</span><span className="text-[var(--muted)]">{d}</span></li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-tokens">
        <p className="eyebrow">02 · Access</p>
        <h2 id="h-tokens" className="serif m-0 mt-2 text-[28px]">Tokens</h2>
        <form onSubmit={createToken} className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="eyebrow" htmlFor="tname">Name</label>
            <input id="tname" className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude Desktop on my laptop" required maxLength={80} />
          </div>
          <button className="btn btn-solid">Create token</button>
          <label className="flex items-start gap-2 text-[13px] text-[var(--muted)] sm:col-span-2">
            <input type="checkbox" className="mt-1" checked={canSync} onChange={(e) => setCanSync(e.target.checked)} />
            <span>Also allow this token to <strong className="text-[var(--ink)]">write</strong> meetings (<span className="mono">memory:sync</span>). Leave off for agents; use it only for the extension&apos;s sync.</span>
          </label>
        </form>

        {fresh && (
          <div className="mt-5 border border-[var(--ok)] p-4" role="status">
            <p className="m-0 text-[13px]">Copy this token now — it is stored only as a hash and cannot be shown again.</p>
            <pre className="code mt-3 select-all">{fresh}</pre>
          </div>
        )}

        <ul className="mt-6 m-0 list-none p-0">
          {tokens.length === 0 && <li className="rule py-4 text-[var(--muted)]">No tokens yet.</li>}
          {tokens.map((t) => (
            <li key={t.id} className="rule flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <span className={t.revokedAt ? "text-[var(--faint)] line-through" : ""}>{t.name}</span>
                <span className="mono ml-3 text-[12px] text-[var(--muted)]">{t.prefix}…</span>
                <div className="mono text-[11.5px] text-[var(--muted)]">{t.scopes.join(" · ")} · {t.rateLimitPerMin}/min · last used {when(t.lastUsedAt)}{t.revokedAt ? ` · revoked ${when(t.revokedAt)}` : ""}</div>
              </div>
              {!t.revokedAt && <button className="btn btn-quiet btn-danger" onClick={() => void revoke(t)}>Revoke</button>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-memory">
        <p className="eyebrow">03 · Memory</p>
        <h2 id="h-memory" className="serif m-0 mt-2 text-[28px]">Synced meetings</h2>
        <p className="mt-3 max-w-[620px] text-[var(--muted)]">Import the <span className="mono text-[13px]">meetings/*.json</span> files the extension exports to your memory folder. Re-importing a meeting updates it.</p>
        <div className="mt-4 flex items-center gap-4">
          <label className="btn cursor-pointer">Import meeting .json<input type="file" accept="application/json,.json" multiple className="sr-only" onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} /></label>
          <span role="status" className="text-[13px] text-[var(--ok)]">{status}</span>
        </div>
        <ul className="mt-6 m-0 list-none p-0">
          {meetings.length === 0 && <li className="rule py-4 text-[var(--muted)]">Nothing synced yet. Agents will find no meetings until you import some.</li>}
          {meetings.map((m) => (
            <li key={m.id} className="rule flex items-start justify-between gap-4 py-3">
              <div>
                <div>{m.title}</div>
                <div className="mono text-[11.5px] text-[var(--muted)]">{when(m.startedAt)} · {Math.round(m.durationSec / 60)} min · {m.id}</div>
                {m.summary && <div className="mt-1 text-[13px] text-[var(--muted)]">{m.summary}</div>}
              </div>
              <button className="btn btn-quiet btn-danger" onClick={() => void removeMeeting(m)}>Remove</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
