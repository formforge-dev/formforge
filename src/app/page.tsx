'use client';

export const dynamic = 'force-dynamic';
// ❌ Remove edge runtime (breaks env vars on Vercel)
// export const runtime = 'edge';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { createClient } from '@supabase/supabase-js';

export default function Home() {
  // ✅ Initialize Supabase *inside* the component
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Missing Supabase environment variables.');
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-red-500 text-center p-10">
        <div>
          <h1 className="text-2xl font-bold mb-4">Missing Supabase Config</h1>
          <p>
            Please ensure <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are defined in your
            Vercel Environment Variables.
          </p>
        </div>
      </main>
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Idle');

  // ---- Dropzone Setup ----
  const onDropSource = useCallback((files: File[]) => setSourceFile(files[0]), []);
  const onDropTarget = useCallback((files: File[]) => setTargetFile(files[0]), []);

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

  // ---- Main Handler ----
  const handleExtractAndFill = async () => {
    if (!sourceFile || !targetFile) {
      alert('Please upload both a Source and Target PDF first.');
      return;
    }

    setLoading(true);
    setStatus('🔍 Extracting data from source…');

    try {
      // 1️⃣ Extract data
      const extractForm = new FormData();
      extractForm.append('source', sourceFile);

      const extractRes = await fetch('/api/fill', {
        method: 'POST',
        body: extractForm,
      });
      if (!extractRes.ok) throw new Error('Claude extraction failed.');

      const { extracted } = await extractRes.json();
      const parsed = JSON.parse(extracted.replace(/```json|```/g, '').trim());

      setStatus('🧠 Mapping data to target form…');

      // 2️⃣ Fill the target
      const fd = new FormData();
      fd.append('target', targetFile);
      fd.append('mapping', JSON.stringify(parsed));

      setStatus('✍️ Filling target PDF…');
      const fillRes = await fetch('/api/fillpdf', { method: 'POST', body: fd });
      if (!fillRes.ok) throw new Error('PDF fill failed.');

      setStatus('📦 Preparing download…');
      const blob = await fillRes.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `filled_${targetFile.name}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setStatus('💾 Saving fill history…');
      await supabase.from('fills').insert({
        user_id: null,
        source_name: sourceFile.name,
        target_name: targetFile.name,
        mapping: parsed,
        created_at: new Date().toISOString(),
      });

      setStatus('✅ Done! File downloaded.');
    } catch (err: any) {
      console.error('❌ Error:', err);
      setStatus(`❌ Error: ${err.message || 'Unknown error'}`);
      alert(err.message || 'Something went wrong. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  // ---- UI ----
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-10 bg-[#0a0a0a] text-white">
      <h1 className="text-4xl font-bold mb-6 text-blue-400">
        FormForge <span className="text-white">AI Form Filler ⚡</span>
      </h1>

      {/* Source Upload */}
      <div
        {...sourceZone.getRootProps({
          className:
            'border-2 border-dashed border-gray-600 p-6 mb-4 cursor-pointer w-72 text-center rounded-xl bg-gray-900 hover:bg-gray-800 transition',
        })}
      >
        <input {...sourceZone.getInputProps()} />
        <p className="text-sm">Drop Source (PDF / Image)</p>
        {sourceFile && (
          <p className="mt-2 text-green-400 truncate">{sourceFile.name}</p>
        )}
      </div>

      {/* Target Upload */}
      <div
        {...targetZone.getRootProps({
          className:
            'border-2 border-dashed border-gray-600 p-6 mb-6 cursor-pointer w-72 text-center rounded-xl bg-gray-900 hover:bg-gray-800 transition',
        })}
      >
        <input {...targetZone.getInputProps()} />
        <p className="text-sm">Drop Target Form (PDF)</p>
        {targetFile && (
          <p className="mt-2 text-green-400 truncate">{targetFile.name}</p>
        )}
      </div>

      <button
        onClick={handleExtractAndFill}
        disabled={loading}
        className={`px-6 py-3 rounded-lg text-white font-semibold transition ${
          loading
            ? 'bg-gray-600 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {loading ? 'Processing… ⏳' : 'Auto-Fill & Download 🚀'}
      </button>

      <p className="text-sm text-gray-400 mt-4 h-6">{status}</p>

      <footer className="mt-10 text-xs text-gray-600 text-center">
        © {new Date().getFullYear()} FormForge — Built with Next.js + Claude + Supabase
      </footer>
    </main>
  );
}
