// components/MigrationHint.tsx
// Friendly banner shown by the lobby dashboards when their backing
// table is missing from PostgREST's schema cache — almost always
// because the named migration hasn't been applied to the Supabase
// project yet. Replaces the previous red "could not find the table"
// error text with something actionable.

interface Props {
  migration: string;
  feature: string;
}

export function MigrationHint({ migration, feature }: Props) {
  return (
    <div className="mt-3 rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-200">
      <p className="font-semibold">{feature} isn’t available yet.</p>
      <p className="mt-1 text-amber-200/80">
        Apply the SQL migration to your Supabase project to enable it:
      </p>
      <p className="mt-1 font-mono text-[11px] text-amber-100">
        supabase/migrations/{migration}
      </p>
      <p className="mt-1 text-amber-200/70">
        Dashboard → SQL Editor → New query → paste the file → Run.
      </p>
    </div>
  );
}
