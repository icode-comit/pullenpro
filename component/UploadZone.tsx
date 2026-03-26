import { useCallback, useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  accept?: string;
  hint?: string;
}

export default function UploadZone({ onFile, accept = ".csv", hint }: Props) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const handle = useCallback((f: File) => {
    setFile(f);
    onFile(f);
  }, [onFile]);

  return (
    <div
      onClick={() => ref.current?.click()}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200 p-10 text-center ${
        dragging
          ? "border-white/40 bg-white/05"
          : file
          ? "border-white/20 bg-white/03"
          : "border-[#2a2a2a] hover:border-[#3a3a3a] hover:bg-white/02"
      }`}
    >
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }} />

      {file ? (
        <>
          <div className="text-3xl mb-3">◈</div>
          <p className="text-white text-sm font-semibold">{file.name}</p>
          <p className="text-[#555] text-xs mt-1 font-mono">{(file.size / 1024).toFixed(1)} KB</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setFile(null); }}
            className="mt-3 text-xs text-[#555] hover:text-white transition"
          >
            Remove
          </button>
        </>
      ) : (
        <>
          <div className="text-4xl mb-4 text-[#2a2a2a]">⊞</div>
          <p className="text-[#666] text-sm">
            Drop your file here or{" "}
            <span className="text-white underline underline-offset-2">browse</span>
          </p>
          {hint && <p className="text-[#444] text-xs mt-2 font-mono">{hint}</p>}
        </>
      )}
    </div>
  );
}
