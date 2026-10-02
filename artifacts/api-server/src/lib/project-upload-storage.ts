import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const PROJECT_UPLOAD_CATEGORIES = [
  "order-documents",
  "measurement-sheets",
  "quotation-rate-pdfs",
  "avatars",
  "window-profiles",
] as const;

export type ProjectUploadCategory = (typeof PROJECT_UPLOAD_CATEGORIES)[number];
export type ProjectImageCategory = Extract<ProjectUploadCategory, "avatars" | "window-profiles">;

function findWorkspaceRoot(startDirectory: string): string {
  let directory = path.resolve(startDirectory);
  while (true) {
    if (existsSync(path.join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error("Could not locate the project root for local upload storage.");
    }
    directory = parent;
  }
}

const uploadsRoot = path.join(findWorkspaceRoot(process.cwd()), "uploads");
const imageExtensions = { jpeg: ".jpg", png: ".png", webp: ".webp" } as const;

export async function storeProjectUpload(
  category: ProjectUploadCategory,
  originalFilename: string,
  bytes: Buffer,
): Promise<string> {
  const rawExtension = path.extname(originalFilename).toLowerCase();
  const extension = /^\.[a-z0-9]{1,8}$/.test(rawExtension) ? rawExtension : "";
  const filename = `${randomUUID()}${extension}`;
  const storagePath = `${category}/${filename}`;
  const absolutePath = resolveProjectUploadPath(storagePath);
  if (!absolutePath) throw new Error("Invalid project upload path.");

  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, bytes, { flag: "wx", mode: 0o600 });
  return storagePath;
}

export function resolveProjectUploadPath(storagePath: string): string | null {
  const segments = storagePath.split("/");
  if (
    segments.length !== 2 ||
    !PROJECT_UPLOAD_CATEGORIES.includes(segments[0] as ProjectUploadCategory) ||
    !/^[A-Za-z0-9-]+\.[A-Za-z0-9]{1,8}$/.test(segments[1])
  ) {
    return null;
  }
  const absolutePath = path.resolve(uploadsRoot, ...segments);
  return absolutePath.startsWith(`${uploadsRoot}${path.sep}`) ? absolutePath : null;
}

export function localImageUrl(storagePath: string): string {
  const absolutePath = resolveProjectUploadPath(storagePath);
  if (!absolutePath || !/^((avatars)|(window-profiles))\//.test(storagePath)) {
    throw new Error("Invalid local image path.");
  }
  return `/api/uploads/${storagePath}`;
}

export function localImageStoragePath(
  imageUrl: string,
  category: ProjectImageCategory,
): string | null {
  const prefix = `/api/uploads/${category}/`;
  if (!imageUrl.startsWith(prefix)) return null;
  const storagePath = `${category}/${imageUrl.slice(prefix.length)}`;
  const absolutePath = resolveProjectUploadPath(storagePath);
  return absolutePath ? storagePath : null;
}

export function isLocalImageUrl(
  imageUrl: string,
  category: ProjectImageCategory,
): boolean {
  return localImageStoragePath(imageUrl, category) !== null;
}

export async function storeImageDataUrl(
  imageDataUrl: string,
  category: ProjectImageCategory,
  maxBytes: number,
): Promise<string | null> {
  const existingPath = localImageStoragePath(imageDataUrl, category);
  if (existingPath) return imageDataUrl;

  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl);
  if (!match) return null;
  const mime = match[1] as keyof typeof imageExtensions;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > maxBytes || !hasImageSignature(mime, bytes)) {
    return null;
  }

  const storagePath = await storeProjectUpload(
    category,
    `upload${imageExtensions[mime]}`,
    bytes,
  );
  return localImageUrl(storagePath);
}

export async function removeProjectUpload(storagePath: string): Promise<void> {
  const absolutePath = resolveProjectUploadPath(storagePath);
  if (absolutePath) await rm(absolutePath, { force: true });
}

function hasImageSignature(
  mime: keyof typeof imageExtensions,
  bytes: Buffer,
): boolean {
  if (mime === "jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "png") {
    return bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}