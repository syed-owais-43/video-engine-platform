"use client";

import { useState } from "react";

export function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      {label && <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-faint">{label}</p>}
      <pre className="code pr-16">{code}</pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className={`absolute right-2 ${label ? "top-7" : "top-2"} rounded-md border border-line bg-ink-2 px-2 py-1 text-[11px] text-muted hover:text-paper`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
