'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';

export default function Home() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);

  const onDropSource = (files: File[]) => setSourceFile(files[0]);
  const onDropTarget = (files: File[]) => setTargetFile(files[0]);

  const { getRootProps: sourceProps } = useDropzone({ onDrop: onDropSource });
  const { getRootProps: targetProps } = useDropzone({ onDrop: onDropTarget });

  const handleFill = async () => {
    if (!sourceFile) return alert('Drop a source file first!');

    const formData = new FormData();
    formData.append('source', sourceFile);

    try {
      const res = await fetch('/api/fill', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('API failed: ' + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      alert(data.extracted);
    } catch (error) {
      alert('Error: ' + error.message);
    }
  };

  return (
    <div className="flex flex-col items-center p-8">
      <h1 className="text-3xl font-bold mb-6">FormForge: AI Form Filler</h1>
      <div {...sourceProps()} className="border-2 border-dashed p-6 mb-4 cursor-pointer w-64 text-center">
        Drop Source (PDF/Image/Email)
        {sourceFile && <p>{sourceFile.name}</p>}
      </div>
      <div {...targetProps()} className="border-2 border-dashed p-6 mb-4 cursor-pointer w-64 text-center">
        Drop Target Form (PDF)
        {targetFile && <p>{targetFile.name}</p>}
      </div>
      <button className="bg-blue-500 text-white px-4 py-2 rounded" onClick={handleFill}>Fill Form</button>
    </div>
  );
}