'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { createClient } from '@supabase/supabase-js';

type Step = 1 | 2 | 3;

export default function Home() {
  // 🔐 Supabase client (browser-side)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Missing Supabase env vars in Vercel');
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-red-500 text-center p-6">
        <div>
          <h1 className="text-2xl font-bold mb-4">Supabase Not Configured</h1>
          <p className="mb-2">
            Please add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your Vercel project
            settings.
          </p>
        </div>
      </main>
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // 🔄 Wizard state
  const [step, setStep] = useState<Step>(1);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('Idle');
  const [error, setError] = useState<string | null>(null);

  // 📥 Dropzones
  const onDropSource = useCallback((files: File[]) => {
    setSourceFile(files[0]);
  }, []);

  const onDropTarget = useCallback((files: File[]) => {
    setTargetFile(files[0]);
  }, []);

  const sourceZone = useDropzone({
    onDrop: onDropSource,
    multiple: false,
    accept: { 'application/pdf': ['.pdf'], 'image/*': [] },
  });

  const targetZone = useDropzone({
    onDrop: onDropTarget,
    multiple: false,
    accept: { 'application/pdf': ['.pdf'] },
  });

  // 👉 Step 1 → Step 2 (just UI transition)
  const handleGoToStep2 = () => {
    if (!sourceFile || !targetFile) {
      alert('Please upload BOTH Source and Target PDFs first.');
      return;
    }
    setError(null);
    setStatus('Ready to run AI extraction & filling…');
    setStep(2);
  };

  // 🚀 Run AI + PDF fill (calls /api/fill once)
  const handleRunAutoFill = async () => {
    if (!sourceFile || !targetFile) {
      alert('Please upload both files first.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setStatus('🔍 Sending files to FormForge AI…');

      const formData = new FormData();
      formData.append('source', sourceFile);
      formData.append('target', targetFile);

      const res = await fetch('/api/fill', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('❌ /api/fill error response:', text);
        throw new Error(text || 'FormForge API returned an error.');
      }

      setStatus('📦 Preparing filled PDF download…');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `filled_${targetFile.name}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setStatus('💾 Logging fill to Supabase…');

      // optional – don't block user if this fails
      try {
        await supabase.from('fills').insert({
          user_id: null,
          source_name: sourceFile.name,
          target_name: targetFile.name,
          // you can extend this later with mapping, runtime logs etc.
          created_at: new Date().toISOString(),
        });
      } catch (logErr: any) {
        console.warn('⚠️ Failed to log to Supabase:', logErr?.message || logErr);
      }

      setStatus('✅ Done! Your filled PDF has been downloaded.');
      setStep(3);
    } catch (err: any) {
      console.error('❌ handleRunAutoFill error:', err);
      const msg = err?.message || 'Unknown error while filling PDF.';
      setError(msg);
      setStatus('❌ Something went wrong.');
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  // 🔁 Start another fill
  const handleStartOver = () => {
    setStep(1);
    setSourceFile(null);
    setTargetFile(null);
    setStatus('Idle');
    setError(null);
  };

  // Small helper for step bubbles
  const StepBubble = ({ n, label }: { n: Step; label: string }) => {
    const active = step === n;
    const completed = step > n;

    const base =
      'flex items-center gap-2 px-4 py-2 rounded-full text-sm border transition';
    const activeClass =
      'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/30';
    const completedClass = 'bg-emerald-600 border-emerald-500 text-white';
    const idleClass = 'bg-transparent border-gray-700 text-gray-400';

    return (
      <div
        className={`${base} ${
          completed ? completedClass : active ? activeClass : idleClass
        }`}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-xs font-bold">
          {n}
        </span>
        <span>{label}</span>
      </div>
    );
  };

  return (
    <main className="min-h-screen w-full bg-[#050509] text-white flex flex-col items-center">
      {/* Top bar */}
      <header className="w-full max-w-5xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-blue-600 flex items-center justify-center text-sm font-black">
            FF
          </div>
          <div>
            <h1 className="font-semibold leading-tight">FormForge</h1>
            <p className="text-xs text-gray-500">
              AI-powered PDF form filler for busy humans 🧠⚡
            </p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Claude • Supabase • Next.js 16</span>
        </div>
      </header>

      {/* Wizard container */}
      <section className="w-full max-w-5xl px-6 pb-10">
        {/* Step indicator */}
        <div className="mb-6 flex flex-wrap gap-3 items-center justify-center sm:justify-between">
          <div className="flex flex-wrap gap-3">
            <StepBubble n={1} label="Upload PDFs" />
            <StepBubble n={2} label="Run AI Auto-Fill" />
            <StepBubble n={3} label="Download Result" />
          </div>
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-white/5 to-black/60 shadow-[0_0_40px_rgba(0,0,0,0.7)] p-6 sm:p-8 flex flex-col lg:flex-row gap-8">
          {/* Left side: step content */}
          <div className="flex-1 flex flex-col gap-4">
            {/* Step title & description */}
            {step === 1 && (
              <>
                <h2 className="text-2xl font-semibold">
                  1. Upload your documents
                </h2>
                <p className="text-sm text-gray-400">
                  Drop a <span className="font-medium text-gray-200">Source</span>{' '}
                  document (like a scanned contract or ID), and the{' '}
                  <span className="font-medium text-gray-200">Target PDF form</span>{' '}
                  you want FormForge to auto-fill.
                </p>

                <div className="mt-4 flex flex-col md:flex-row gap-4">
                  {/* Source */}
                  <div
                    {...sourceZone.getRootProps({
                      className:
                        'flex-1 border-2 border-dashed rounded-xl px-4 py-6 text-center cursor-pointer bg-black/40 hover:bg-black/60 border-gray-700 hover:border-blue-500 transition',
                    })}
                  >
                    <input {...sourceZone.getInputProps()} />
                    <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                      Source (PDF / Image)
                    </p>
                    <p className="text-sm text-gray-200">
                      {sourceFile ? (
                        <span className="text-emerald-400 truncate inline-block max-w-full">
                          {sourceFile.name}
                        </span>
                      ) : (
                        'Drop file here or click to browse'
                      )}
                    </p>
                  </div>

                  {/* Target */}
                  <div
                    {...targetZone.getRootProps({
                      className:
                        'flex-1 border-2 border-dashed rounded-xl px-4 py-6 text-center cursor-pointer bg-black/40 hover:bg-black/60 border-gray-700 hover:border-blue-500 transition',
                    })}
                  >
                    <input {...targetZone.getInputProps()} />
                    <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                      Target Form (PDF)
                    </p>
                    <p className="text-sm text-gray-200">
                      {targetFile ? (
                        <span className="text-emerald-400 truncate inline-block max-w-full">
                          {targetFile.name}
                        </span>
                      ) : (
                        'Drop PDF here or click to browse'
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleGoToStep2}
                    disabled={!sourceFile || !targetFile}
                    className={`px-6 py-2 rounded-lg text-sm font-medium transition ${
                      !sourceFile || !targetFile
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                    }`}
                  >
                    Continue to AI Auto-Fill →
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-2xl font-semibold">
                  2. Let FormForge fill it for you
                </h2>
                <p className="text-sm text-gray-400">
                  We’ll send your Source + Target PDFs to FormForge AI, extract
                  structured data, and auto-fill the target form. Then you’ll
                  instantly get a downloadable filled PDF.
                </p>

                <div className="mt-6 flex flex-col gap-3">
                  <button
                    onClick={handleRunAutoFill}
                    disabled={loading}
                    className={`px-6 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ${
                      loading
                        ? 'bg-gray-700 text-gray-300 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                    }`}
                  >
                    {loading ? (
                      <>
                        <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Processing with AI…
                      </>
                    ) : (
                      <>
                        ⚡ Run AI Auto-Fill & Generate PDF
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleStartOver}
                    disabled={loading}
                    className="self-start text-xs text-gray-400 hover:text-gray-200 underline underline-offset-2"
                  >
                    ← Start over (upload different files)
                  </button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="text-2xl font-semibold">
                  3. Your filled PDF is ready 🎉
                </h2>
                <p className="text-sm text-gray-400">
                  We&apos;ve downloaded the filled PDF to your device. You can
                  run another fill with different documents or close the tab.
                </p>

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={handleStartOver}
                    className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                  >
                    Run another fill
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Right side: status panel */}
          <aside className="w-full lg:w-72 border border-white/5 rounded-2xl bg-black/40 p-4 flex flex-col gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Status
              </p>
              <div className="text-sm">
                <p className="text-gray-200">{status}</p>
                {error && (
                  <p className="mt-2 text-xs text-red-400 break-words">
                    Error: {error}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-white/5 pt-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Current files
              </p>
              <div className="text-xs text-gray-300 space-y-1">
                <p>
                  <span className="text-gray-500">Source:</span>{' '}
                  {sourceFile ? (
                    <span className="text-emerald-400">{sourceFile.name}</span>
                  ) : (
                    <span className="text-gray-600">Not selected</span>
                  )}
                </p>
                <p>
                  <span className="text-gray-500">Target:</span>{' '}
                  {targetFile ? (
                    <span className="text-emerald-400">{targetFile.name}</span>
                  ) : (
                    <span className="text-gray-600">Not selected</span>
                  )}
                </p>
              </div>
            </div>

            <div className="border-t border-white/5 pt-3 text-[11px] text-gray-500">
              <p>We never store your PDFs permanently.</p>
              <p>Each fill is processed on-demand and logged only as metadata.</p>
            </div>
          </aside>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-5xl px-6 pb-6 text-[11px] text-gray-600 flex justify-between flex-wrap gap-2">
        <span>© {new Date().getFullYear()} FormForge. All rights reserved.</span>
        <span>Built with Next.js, Claude, Supabase & Vercel.</span>
      </footer>
    </main>
  );
}
