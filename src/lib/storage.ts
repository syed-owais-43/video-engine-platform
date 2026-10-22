import "server-only";
import { del, put } from "@vercel/blob";

// Library files (style previews, reference videos, resource packs) can be large, so they live in
// Vercel Blob when the project has a Blob store connected: Vercel adds BLOB_READ_WRITE_TOKEN
// automatically. Without one (local testing, or before the owner adds a store) they are kept in the
// database, which only suits small items.
export const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  json: "application/json",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  lottie: "application/zip",
  zip: "application/zip",
};

export const contentTypeFor = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
export const knownType = (path: string) => (path.split(".").pop()?.toLowerCase() ?? "") in TYPES;

export type Stored = { url: string | null; data: string | null };

export async function storeFile(path: string, body: Buffer, contentType: string): Promise<Stored> {
  if (!blobEnabled()) return { url: null, data: body.toString("base64") };
  const r = await put(`library/${path}`, body, { access: "public", addRandomSuffix: true, contentType });
  return { url: r.url, data: null };
}

export async function removeStored(urls: (string | null)[]) {
  const list = urls.filter((u): u is string => Boolean(u));
  if (!list.length || !blobEnabled()) return;
  await del(list).catch((e) => console.error("Couldn't delete old library files from Blob:", e));
}

export async function readStored(file: { url: string | null; data: string | null }): Promise<Buffer> {
  if (file.data !== null) return Buffer.from(file.data, "base64");
  if (!file.url) throw new Error("File has no content");
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`Couldn't read ${file.url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
