"use client";

import { FormEvent, useState } from "react";

const EXAMPLE_PROMPTS = [
  "Show open Jira tickets with delivery risk",
  "Get recent GitHub PRs for auth service",
];

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerTimestamp, setAnswerTimestamp] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();

    if (!trimmed || isLoading) {
      return;
    }

    setPrompt("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "Agent request failed");
      }

      const payload = await response.json();
      const rawResult = payload?.result;
      const normalized = typeof rawResult === "string" ? rawResult.trim() : "Summary available.";

      setAnswer(normalized || "No response returned.");
      setAnswerTimestamp(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10 lg:px-8">
        <header className="flex items-center justify-between text-xs uppercase tracking-[0.4em] text-slate-400">
          <span>DIRECTV Delivery Agent</span>
          <span className="flex items-center gap-2 text-[11px] tracking-tight text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden /> Connected
          </span>
        </header>

        <main className="mt-20 flex flex-1 flex-col items-stretch">
          <section className="rounded-[40px] border border-white/10 bg-gradient-to-b from-slate-900/90 via-slate-900/70 to-slate-950/60 p-10 text-center shadow-panel">
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold text-white">DIRECTV Delivery Agent</h1>
              <p className="text-base text-slate-300">One agent for Jira, GitHub, and delivery insights.</p>
            </div>

            <form className="mt-10 space-y-4" onSubmit={handleSubmit}>
              <label htmlFor="agent-input" className="sr-only">
                Ask DIRECTV Delivery Agent
              </label>
              <div className="rounded-[32px] border border-white/15 bg-slate-950/40 px-6 py-4 text-left shadow-inner shadow-slate-950/80 transition focus-within:border-sky-300/60">
                <input
                  id="agent-input"
                  type="text"
                  className="w-full bg-transparent text-lg text-white placeholder:text-slate-500 focus:outline-none"
                  placeholder="What can I help you with?"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  disabled={isLoading}
                  aria-label="Ask DIRECTV Delivery Agent"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || !prompt.trim()}
                className="mx-auto inline-flex items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-blue-500 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:shadow-sky-400/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-200 disabled:opacity-50"
              >
                {isLoading ? "Contacting agent…" : "Ask Agent"}
              </button>
              {isLoading && (
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Running live analysis…</p>
              )}
            </form>

            <div className="mt-8 space-y-1 text-sm text-slate-500">
              {EXAMPLE_PROMPTS.map((example) => (
                <p key={example}>• {example}</p>
              ))}
            </div>

            {error && (
              <p className="mt-6 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </p>
            )}

            {answer && (
              <div className="mt-10 text-left">
                <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Latest response</p>
                <div className="mt-3 rounded-[28px] border border-white/10 bg-slate-950/40 p-6 text-base leading-7 text-slate-100 whitespace-pre-wrap">
                  {answer}
                </div>
                {answerTimestamp && (
                  <p className="mt-3 text-xs text-slate-500">Generated {formatTimestamp(answerTimestamp)}</p>
                )}
              </div>
            )}
          </section>
        </main>

        <footer className="mt-12 space-y-1 text-center text-xs text-slate-500">
          <p>Connected to Jira & GitHub · Powered by Google ADK & Gemini</p>
          <p>/api/agent · DIRECTV internal use</p>
        </footer>
      </div>
    </div>
  );
}
