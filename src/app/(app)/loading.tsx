// Every screen reads the signed-in user's data, so it streams in behind this placeholder.
export default function Loading() {
  return (
    <div role="status" aria-label="טוען" className="space-y-4">
      <div className="h-9 w-40 animate-pulse rounded-xl bg-line" />
      <div className="h-44 animate-pulse rounded-3xl bg-line" />
      <div className="h-24 animate-pulse rounded-3xl bg-line" />
      <div className="h-24 animate-pulse rounded-3xl bg-line" />
    </div>
  );
}
