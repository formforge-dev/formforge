'use client';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/lib/supabaseClient'; // ✅ import our helper

export default function Home() {
  // ✅ Move Supabase client initialization *inside* the component

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

      {/* ...rest of your UI stays the same... */}
    </main>
  );
}
