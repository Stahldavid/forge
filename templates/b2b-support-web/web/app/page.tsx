import Link from "next/link";

export default function HomePage() {
  return (
    <main className="stack">
      <h1>ForgeOS B2B Support Demo</h1>
      <p className="muted">Minimal full-stack support app powered by ForgeOS.</p>
      <p>
        <Link href="/tickets">Open tickets</Link>
      </p>
    </main>
  );
}
