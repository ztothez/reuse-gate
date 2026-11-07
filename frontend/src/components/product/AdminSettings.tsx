import { useEffect, useState } from "react";
import {
  getAccessCode,
  getApiBaseUrl,
  getHealth,
  getOwners,
  getProviderInfo,
  saveAccessCode,
} from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { ListState, PageHeading } from "./shared";
export function AdminSettings() {
  const health = useResource(getHealth);
  const owners = useResource(getOwners);
  const providers = useResource(getProviderInfo);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => setCode(getAccessCode()), []);
  return (
    <>
      <PageHeading
        title="Admin settings"
        description="Connection, session access and the people responsible for governed reporting."
      />
      <a className="request-link mb-4" href="/evaluation">
        View evaluation methods and limits
      </a>
      <div className="grid min-w-0 gap-8 lg:grid-cols-2">
        <form
          className="panel space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              saveAccessCode(code);
              setNotice(
                code
                  ? "Access code saved for this browser session."
                  : "Session access code cleared.",
              );
            } catch {
              setNotice("Session storage is unavailable. The access code could not be saved.");
            }
          }}
        >
          <h2 className="section-title">Session access</h2>
          <label className="block text-sm font-semibold" htmlFor="admin-code">
            Access code
          </label>
          <input
            id="admin-code"
            className="control w-full"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby="code-help"
          />
          <p id="code-help" className="text-sm text-muted-foreground">
            For an API with one shared write token: approval and remediation send this code. An API
            with role codes asks you to sign in instead, and then every call carries your code. It
            stays in sessionStorage, never in a URL or a log.
          </p>
          <button className="primary-action" type="submit">
            Save session access
          </button>
        </form>
        <section className="panel space-y-4">
          <h2 className="section-title">API connection</h2>
          <ListState
            loading={health.loading}
            error={health.error}
            empty={false}
            retry={health.reload}
          />
          {health.data && (
            <p className="text-sm font-semibold">
              {health.data.status === "live"
                ? `Live API${health.data.assets !== undefined ? `, ${health.data.assets} assets loaded` : ""}`
                : health.data.status === "down"
                  ? "API unavailable"
                  : "No API configured. Offline demo data."}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button className="control" onClick={health.reload}>
              Check connection
            </button>
            <button
              className="control"
              onClick={() => {
                const base = getApiBaseUrl();
                if (!base) {
                  setNotice("No API base URL is configured.");
                  return;
                }
                void navigator.clipboard
                  .writeText(base)
                  .then(() => setNotice("API base URL copied."))
                  .catch(() => setNotice("The API base URL could not be copied."));
              }}
            >
              Copy API base URL
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Connection is reported by GET /health. An absent provider status stays unknown.
          </p>
        </section>
      </div>
      {notice && (
        <p role="status" className="panel my-6 text-sm">
          {notice}
        </p>
      )}
      <section className="panel my-8">
        <h2 className="section-title">Provider status</h2>
        <ListState
          loading={providers.loading}
          error={providers.error}
          empty={false}
          retry={providers.reload}
        />
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {["intent", "explanation", "speech", "transcription"].map((name) => (
            <div key={name}>
              <dt className="font-semibold capitalize">{name}</dt>
              <dd className="mt-1 text-muted-foreground">
                {providers.data?.[name as keyof NonNullable<typeof providers.data>]?.replace(
                  /_/g,
                  " ",
                ) ?? "Unknown (not provided by API)"}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h2 className="section-title">Active owners</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          GET /owners lists active owners only, with Semantic Model Owners first. Role and scope are
          advisory, not enforced by the active-owner gate.
        </p>
        <ListState
          loading={owners.loading}
          error={owners.error}
          empty={!owners.data?.length}
          emptyText="No active owners were returned. Check the API connection before assigning ownership."
          retry={owners.reload}
        />
        {!!owners.data?.length && (
          <div className="table-region" tabIndex={0} role="region" aria-label="Active owners">
            <table className="product-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Scope</th>
                </tr>
              </thead>
              <tbody>
                {owners.data.map((owner) => (
                  <tr key={owner.owner_id}>
                    <td className="font-semibold">
                      {owner.owner_name}
                      <p className="mt-2 text-xs font-normal text-muted-foreground">
                        {owner.owner_id}
                      </p>
                    </td>
                    <td>{owner.role}</td>
                    <td>{owner.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
