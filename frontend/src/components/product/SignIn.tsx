import { useState } from "react";
import { addSession, getMe } from "@/lib/api";
import { isRole } from "@/lib/role";

// The public demo code for judges and voters: a judge code views as any role, with exactly that role's rights.
const DEMO_CODE = "1eecfd9f15528117";

// Sign in with the access code you were given. The API says which role and name the code belongs to; the app never decides.
export function SignIn({ onDone, adding = false }: { onDone: () => void; adding?: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="panel max-w-xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!code.trim() || busy) return;
        setBusy(true);
        setError(null);
        getMe(code.trim())
          .then((me) => {
            if (!me || !isRole(me.role)) {
              setError("That code is not valid. Check it with your administrator.");
              return;
            }
            // A judge code opens every view; it is one session per view, switched in "Viewing as".
            for (const view of (me.views ?? [me.role]).filter((v) => v !== me.role && isRole(v)))
              addSession({ code: code.trim(), role: view, name: me.name });
            addSession({ code: code.trim(), role: me.role, name: me.name });
            setCode("");
            onDone();
          })
          .catch((failure: unknown) =>
            setError(failure instanceof Error ? failure.message : "The API cannot be reached."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h1 className="text-2xl font-semibold">{adding ? "Add a role" : "Sign in to Reuse Gate"}</h1>
      <p className="text-sm text-muted-foreground">
        Your access code decides your role and what you can see. Business users see their own
        requests; analysts and developers read evidence and specs; approvers decide. The code stays
        in this browser tab only.
      </p>
      {!adding && (
        <p className="tone-blue rounded p-3 text-sm">
          Judges and voters: sign in with the access code{" "}
          <strong className="select-all font-mono text-base">{DEMO_CODE}</strong>. It opens every
          role in "Viewing as".
        </p>
      )}
      <label htmlFor="access-code-input" className="block text-sm font-semibold">
        Access code
      </label>
      <input
        id="access-code-input"
        className="control w-full"
        type="password"
        autoComplete="off"
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      {error && (
        <p role="alert" className="tone-red rounded p-3 text-sm">
          {error}
        </p>
      )}
      <button className="primary-action" disabled={busy || !code.trim()}>
        {busy ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}
