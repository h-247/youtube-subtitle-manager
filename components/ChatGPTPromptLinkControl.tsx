"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, MessageSquare, Pencil, Save, X } from "lucide-react";

export default function ChatGPTPromptLinkControl({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (value: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setDraft(value || ""), [value]);

  const save = async () => {
    const trimmed = draft.trim();
    let next: string | null = null;
    if (trimmed) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
        next = trimmed;
      } catch {
        setError("Enter a valid HTTP or HTTPS ChatGPT link.");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      await onSave(next);
      window.dispatchEvent(new CustomEvent("chatgpt-prompt-link-updated", { detail: { value: next } }));
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the prompt link.");
    } finally {
      setSaving(false);
    }
  };

  return <>
    <div className="flex items-center gap-1">
      {value ? (
        <a href={value} target="_blank" rel="noopener noreferrer" title={value} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700">
          <MessageSquare className="h-3.5 w-3.5" /><span>Prompt</span><ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
      <button type="button" onClick={() => setOpen(true)} title={value ? "Edit the shared ChatGPT prompt link" : "Add a shared ChatGPT prompt link"} aria-label={value ? "Edit ChatGPT prompt link" : "Add ChatGPT prompt link"} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700">
        <Pencil className="h-3.5 w-3.5" /><span>{value ? "Edit Prompt" : "Add Prompt"}</span>
      </button>
    </div>
    {open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <section role="dialog" aria-modal="true" aria-label="Shared ChatGPT prompt link" className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-[#262626] p-5 text-neutral-100 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><MessageSquare className="h-5 w-5" />Shared ChatGPT Prompt Link</h2>
            <p className="mt-1 text-xs text-neutral-400">One link for every course. When Local is paired with Sites, changes appear on both.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close prompt link settings" className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <label className="mt-4 block text-xs font-medium text-neutral-300" htmlFor="shared-chatgpt-prompt-link">ChatGPT link</label>
        <input id="shared-chatgpt-prompt-link" type="url" value={draft} onChange={event => setDraft(event.target.value)} placeholder="https://chatgpt.com/..." className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-[#191919] px-3 py-2.5 text-sm outline-none placeholder:text-neutral-500 focus:border-neutral-400" />
        {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setDraft("")} className="rounded-lg px-3 py-2 text-xs text-neutral-400 hover:text-white">Clear link</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving…" : "Save link"}
          </button>
        </div>
      </section>
    </div>}
  </>;
}
