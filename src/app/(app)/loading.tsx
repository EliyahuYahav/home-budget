// Every screen reads the signed-in user's data, so it streams in behind this placeholder.
export default function Loading() {
  return (
    <div role="status" aria-label="טוען" className="space-y-4">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-line" />
      <div className="h-36 animate-pulse rounded-2xl bg-line" />
      <div className="h-24 animate-pulse rounded-2xl bg-line" />
      <div className="h-24 animate-pulse rounded-2xl bg-line" />
    </div>
  );
}
