// components/MigrationHint.tsx
//
// Friendly banner shown by the lobby dashboards when their backing
// table is missing from PostgREST's schema cache — almost always
// because the named migration hasn't been applied to the Supabase
// project yet. Replaces the previous amber card with a single
// hairline-divided row in the same style as the rest of the
// dashboard. We don't shout about this; the user is in a develop-
// ment flow and a one-line instruction is enough.

interface Props {
  migration: string;
  feature: string;
}

export function MigrationHint({ migration, feature }: Props) {
  return (
    <div className="flex flex-col gap-2 border-t hairline-t py-6">
      <p className="micro-label text-state-error">
        {feature} not available
      </p>
      <p className="text-small leading-relaxed text-ink-400">
        Apply the SQL migration to your Supabase project to enable it.
        Path:{' '}
        <span className="font-mono text-ink-200">
          supabase/migrations/{migration}
        </span>
        . Run it in the Supabase Dashboard's SQL Editor.
      </p>
    </div>
  );
}
