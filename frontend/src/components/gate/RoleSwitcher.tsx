import { ROLES, type Role } from "@/lib/role";
import { cn } from "@/lib/utils";

// "Viewing as" changes perspective; write permission comes from the API.
export function RoleSwitcher({
  role,
  onChange,
  className,
}: {
  role: Role;
  onChange: (r: Role) => void;
  className?: string;
}) {
  const current = ROLES.find((r) => r.id === role)!;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
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
        {ROLES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <p id="role-note" className="text-xs text-muted-foreground">
        {current.hint}. Views change what you see first; the API controls who can approve.
      </p>
    </div>
  );
}
