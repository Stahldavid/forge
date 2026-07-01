import Link from "next/link";

export default function HomePage() {
  return (
    <main className="stack">
      <h1>Customer support console</h1>
      <p className="muted">Track open tickets, triage urgent accounts, and review billing operations from one workspace.</p>
      <p>
        <Link href="/tickets">Open tickets</Link>
      </p>
    </main>
  );
}
