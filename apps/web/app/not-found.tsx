import Link from "next/link";
import { Brand } from "../components/brand";

export default function NotFound() {
  return (
    <main id="main-content" className="not-found-page">
      <Brand />
      <div className="not-found-copy">
        <p className="eyebrow">404</p>
        <h1>This room does not exist.</h1>
        <p>The link may be old, or the page may have moved. Check the address, or head back to a room that does.</p>
        <div className="not-found-actions">
          <Link className="button button-primary" href="/app">
            Go to your workspace
          </Link>
          <Link className="button button-secondary" href="/">
            Back to Threadline
          </Link>
        </div>
      </div>
    </main>
  );
}
