import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-4 text-center">
      <h1 className="font-display text-4xl font-bold">אין כאן דף</h1>
      <p className="text-muted">הכתובת לא מובילה לאף מסך באפליקציה.</p>
      <Link href="/" className="btn">
        למסך הבית
      </Link>
    </main>
  );
}
