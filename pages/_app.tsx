import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect, useState } from "react";
import "../styles/globals.css";

function useHttpsRedirect() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ) {
      window.location.replace(window.location.href.replace("http://", "https://"));
    }
  }, []);
}

function useApiHealth() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_API_URL;
    if (!url) { setApiOk(false); return; }
    fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => setApiOk(r.ok))
      .catch(() => setApiOk(false));
  }, []);
  return apiOk;
}

export default function App({ Component, pageProps }: AppProps) {
  useHttpsRedirect();
  const apiOk = useApiHealth();

  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <meta name="description" content="Pullenspro — precision lead enrichment & email verification" />
        <title>Pullenspro</title>
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      {apiOk === false && (
        <div role="alert" className="fixed top-0 inset-x-0 z-[9999] bg-[#1a0000] border-b border-red-900/50 text-red-400 text-center text-xs py-2 px-4 font-mono">
          ⚠ API unreachable — check your connection or Railway deployment
        </div>
      )}

      <Component {...pageProps} />
    </>
  );
}
