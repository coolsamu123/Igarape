'use client';

import { useState, useCallback } from 'react';
import { useProjectContext } from '@/context/ProjectContext';

export default function FileUpload() {
  const { uploadFile, isLoading } = useProjectContext();
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<{ count: number; errors: string[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setUploadError(null);
    setResult(null);
    try {
      const res = await uploadFile(file);
      setResult(res);
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    }
  }, [uploadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-gray-100 mb-2">CIOO Project Intelligence</h2>
        <p className="text-gray-400">Upload the CIOO Status Tracking Excel file to get started</p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative w-full max-w-md border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
          ${isDragging ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 bg-gray-900/50 hover:border-gray-500'}`}
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isLoading}
        />
        <div className="text-4xl mb-4">{isLoading ? '...' : '+'}</div>
        <div className="text-sm text-gray-300 font-medium mb-1">
          {isLoading ? 'Processing...' : 'Drop .xlsx file here or click to browse'}
        </div>
        <div className="text-xs text-gray-500">
          Copy of Status Tracking of Projects for CIOO.xlsx
        </div>
      </div>

      {result && (
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 max-w-md w-full">
          <div className="text-green-300 font-semibold text-sm mb-1">
            Successfully imported {result.count} project entries
          </div>
          {result.errors.length > 0 && (
            <div className="text-yellow-400 text-xs mt-2">
              {result.errors.length} warnings:
              <ul className="list-disc pl-4 mt-1">
                {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 max-w-md w-full">
          <div className="text-red-300 text-sm">{uploadError}</div>
        </div>
      )}
    </div>
  );
}
