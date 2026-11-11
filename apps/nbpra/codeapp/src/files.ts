import type { FileContent } from "./data/types";

/** Reads a picked file into the shape the server operations take. */
export function readFile(file: File): Promise<FileContent> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = () => resolve({ fileName: file.name, contentType: file.type || "application/octet-stream", base64: String(reader.result).split(",")[1] ?? "" });
    reader.readAsDataURL(file);
  });
}

/** Hands a file to the browser to save. */
export function saveToDisk(f: FileContent): void {
  const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // matches the server limit
