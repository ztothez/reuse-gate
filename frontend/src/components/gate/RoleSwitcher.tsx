import { ROLES, type Access, type Role } from "@/lib/role";
import { cn } from "@/lib/utils";

const OPEN: Access = { enforced: false, signedIn: true, name: null, roles: ROLES.map((r) => r.id) };

// "Viewing as": with enforced access codes, only the roles this tab is signed in to; without them (local development),
// every role. The API decides what each role may see either way.
export function RoleSwitcher({
  role,
  onChange,
  access = OPEN,
  onAdd,
  onSignOut,
  className,
}: {
  role: Role;
  onChange: (r: Role) => void;
  access?: Access;
  onAdd?: () => void;
  onSignOut?: () => void;
  className?: string;
}) {
  const current = ROLES.find((r) => r.id === role)!;
  const choices = ROLES.filter((r) => access.roles.includes(r.id) || r.id === role);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {access.enforced && access.name && (
        <p className="text-xs text-muted-foreground">
          Signed in as <span className="font-semibold text-foreground">{access.name}</span>
        </p>
      )}
      <label htmlFor="viewing-as" className="text-xs text-muted-foreground">
        Viewing as
      </label>
      <select
        id="viewing-as"
        className="control w-full font-semibold"
        value={role}
        aria-describedby="role-note"
        onChange={(event) => onChange(event.target.value as Role)}
      >
        {choices.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <p id="role-note" className="text-xs text-muted-foreground">
        {current.hint}.{" "}
        {access.enforced
          ? "Your access code sets your role; the API returns only what it allows."
          : "Views change what you see first; the API controls who can approve."}
      </p>
      {access.enforced && (
        <div className="flex flex-wrap gap-2">
          {onAdd && (
            <button type="button" className="control text-xs" onClick={onAdd}>
              Add a role
            </button>
          )}
          {onSignOut && (
            <button type="button" className="control text-xs" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
