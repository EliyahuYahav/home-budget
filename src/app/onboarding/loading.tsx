export default function Loading() {
  return (
    <div role="status" aria-label="טוען" className="mx-auto max-w-sm space-y-4 p-4 pt-24">
      <div className="h-8 w-32 animate-pulse rounded-lg bg-line" />
      <div className="h-56 animate-pulse rounded-2xl bg-line" />
    </div>
  );
}
