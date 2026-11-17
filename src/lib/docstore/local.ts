import { mkdir, writeFile, readdir, stat, access, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { DocumentStore, FileMetadata, StoredItem } from "./types";

/** Mirrors the SharePoint folder on local disk. Development and tests only. */
export class LocalDocumentStore implements DocumentStore {
  constructor(private root: string) {}

  private item(rel: string): StoredItem {
    const parts = rel.split("/").filter(Boolean);
    return { driveId: "local", itemId: `local:${rel}`, path: rel, name: parts.at(-1) ?? "", version: "1.0" };
  }

  async ensureFolder(relPath: string) {
    await mkdir(join(this.root, relPath), { recursive: true });
    return this.item(relPath);
  }

  async exists(relPath: string) {
    try {
      await access(join(this.root, relPath));
      return true;
    } catch {
      return false;
    }
  }

  async upload(folderRelPath: string, name: string, content: Buffer) {
    const rel = `${folderRelPath}/${name}`;
    if (await this.exists(rel)) throw new Error(`File exists, will not overwrite: ${rel}`);
    await mkdir(dirname(join(this.root, rel)), { recursive: true });
    await writeFile(join(this.root, rel), content, { flag: "wx" });
    return this.item(rel);
  }

  async setMetadata(item: StoredItem, meta: FileMetadata) {
    await writeFile(join(this.root, `${item.path}.meta.json`), JSON.stringify(meta, null, 2));
  }

  async list(folderRelPath: string) {
    const dir = join(this.root, folderRelPath);
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: StoredItem[] = [];
    for (const n of names) {
      if (n.endsWith(".meta.json")) continue;
      const s = await stat(join(dir, n));
      out.push({ ...this.item(`${folderRelPath}/${n}`), version: s.isDirectory() ? undefined : "1.0" });
    }
    return out;
  }

  async download(_itemId: string, relPath: string) {
    return readFile(join(this.root, relPath));
  }
}
