import { Video, Shield, ArrowRight } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[#212121] text-neutral-100 flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl border border-neutral-800 bg-[#262626] p-8 shadow-xl">
        <div className="mb-6 flex items-center justify-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-neutral-700 bg-neutral-800"><Video className="h-6 w-6" /></div></div>
        <h1 className="text-center text-xl font-semibold">YouTube Subtitle Manager</h1>
        <p className="mt-2 text-center text-sm text-neutral-400">Sign in with ChatGPT to open your private subtitle library.</p>
        <a href="/signin-with-chatgpt?return_to=%2Fdashboard" target="_top" className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200"><span>Continue with ChatGPT</span><ArrowRight className="h-4 w-4" /></a>
        <p className="mt-5 flex items-center justify-center gap-2 text-xs text-neutral-500"><Shield className="h-3.5 w-3.5" />Your library is private to your ChatGPT account.</p>
      </section>
    </main>
  );
}
