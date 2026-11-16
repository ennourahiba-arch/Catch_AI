import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, cleanCode, tokens } from "../lib/api";

export default function Join() {
  const params = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(cleanCode(params.code ?? ""));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const existing = code.length === 5 ? tokens.get("team", code) : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.join(code, name.trim());
      tokens.set("team", r.code, { token: r.team_token, name: r.team_name });
      navigate(`/class/${r.code}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-10">
      <h1 className="text-3xl font-bold">Join the class quiz</h1>
      <p className="mt-1 text-navy-mute">One phone per team. No accounts and no real names: just a team nickname for this quiz.</p>

      {existing && (
        <button className="btn-violet mt-6 w-full" onClick={() => navigate(`/class/${code}`)}>
          Rejoin as {existing.name}
        </button>
      )}

      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        <label className="grid gap-1.5">
          <span className="font-bold">Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="e.g. K7P2M"
            className="min-h-[56px] rounded-xl border border-line bg-white px-4 font-display text-2xl font-bold tracking-[0.2em] outline-none focus:border-violet"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="font-bold">Team nickname</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            autoComplete="off"
            placeholder="e.g. The Tangents"
            className="min-h-[52px] rounded-xl border border-line bg-white px-4 outline-none focus:border-violet"
          />
        </label>
        {err && <p className="rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}
        <button className="btn-primary" disabled={busy || code.length < 5 || !name.trim()}>
          {busy && <Loader2 size={17} className="animate-spin" aria-hidden />} Join room
        </button>
      </form>
    </div>
  );
}
