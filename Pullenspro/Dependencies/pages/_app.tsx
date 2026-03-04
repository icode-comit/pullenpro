import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect, useState } from "react";
import "../styles/globals.css";

// ── Global error boundary ─────────────────────────────────────────
class ErrorBoundary extends Error {}

// ── Production HTTPS redirect (client-side guard) ─────────────────
function useHttpsRedirect() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ) {
      window.location.replace(
        window.location.href.replace("http://", "https://")
      );
    }
  }, []);
}

// ── API health check on mount ──────────────────────────────────────
function useApiHealth() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      console.error(
        "[Pullenspro] NEXT_PUBLIC_API_URL is not set. API calls will fail."
      );
      setApiOk(false);
      return;
    }
    fetch(${apiUrl}/health, { signal: AbortSignal.timeout(5000) })
      .then((r) => setApiOk(r.ok))
      .catch(() => setApiOk(false));
  }, []);

  return apiOk;
}

// ── App shell ─────────────────────────────────────────────────────
export default function App({ Component, pageProps }: AppProps) {
  useHttpsRedirect();
  const apiOk = useApiHealth();

  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#4f46e5" />
        <meta
          name="description"
          content="Pullenspro — high-performance B2B lead enrichment platform"
        />
        <title>Pullenspro</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* API offline banner */}
      {apiOk === false && (
        <div
          role="alert"
          className="fixed top-0 inset-x-0 z-50 bg-red-600 text-white text-center text-sm py-2 px-4 font-semibold"
        >
          ⚠️ Cannot reach the Pullenspro API. Check your connection or try
          again shortly.
        </div>
      )}

      <Component {...pageProps} />
    </>
  );
}