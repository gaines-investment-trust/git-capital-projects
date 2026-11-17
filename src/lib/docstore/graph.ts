import { ClientSecretCredential, DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import type { DocumentStore, FileMetadata, StoredItem } from "./types";

/**
 * SharePoint through Microsoft Graph, app-only, with Sites.Selected granted on the one site
 * that holds "GIT Project Management Claude Platform" (security 2.3). Works only from ids:
 * the main folder is resolved once at setup to (driveId, rootItemId).
 */
export class GraphDocumentStore implements DocumentStore {
  private cred: TokenCredential;
  private folderCache = new Map<string, StoredItem>();

  constructor(
    private opts: { tenantId: string; clientId: string; clientSecret?: string; driveId: string; rootItemId: string },
  ) {
    this.cred = opts.clientSecret
      ? new ClientSecretCredential(opts.tenantId, opts.clientId, opts.clientSecret)
      : new DefaultAzureCredential({ managedIdentityClientId: opts.clientId });
  }

  private async token() {
    const t = await this.cred.getToken("https://graph.microsoft.com/.default");
    if (!t) throw new Error("Could not get a Microsoft Graph token");
    return t.token;
  }

  private async call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}, raw = false): Promise<any> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
      });
      if (res.status === 429 || res.status === 503) {
        const wait = Number(res.headers.get("Retry-After") ?? 2 ** attempt);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Graph ${method} ${url} failed: ${res.status} ${await res.text()}`);
      return res.status === 204 ? {} : res.json();
    }
    throw new Error(`Graph ${method} ${url}: throttled too long`);
  }

  private toItem(j: any, path: string): StoredItem {
    return {
      driveId: j.parentReference?.driveId ?? this.opts.driveId,
      itemId: j.id,
      path,
      name: j.name,
      webUrl: j.webUrl,
      version: j.file ? j.cTag : undefined,
    };
  }

  private enc(relPath: string) {
    return relPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  }

  private byPath(relPath: string) {
    return `/drives/${this.opts.driveId}/items/${this.opts.rootItemId}:/${this.enc(relPath)}`;
  }

  async exists(relPath: string) {
    return (await this.call("GET", this.byPath(relPath))) !== null;
  }

  async ensureFolder(relPath: string): Promise<StoredItem> {
    const parts = relPath.split("/").filter(Boolean);
    let parentId = this.opts.rootItemId;
    let current = "";
    let last: StoredItem | null = null;
    for (const p of parts) {
      current = current ? `${current}/${p}` : p;
      const cached = this.folderCache.get(current);
      if (cached) {
        parentId = cached.itemId;
        last = cached;
        continue;
      }
      let j = await this.call("GET", this.byPath(current));
      if (!j) {
        j = await this.call("POST", `/drives/${this.opts.driveId}/items/${parentId}/children`, {
          name: p,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }).catch(async (e: Error) => {
          // Created concurrently by another request: read it back.
          if (String(e.message).includes("409")) return this.call("GET", this.byPath(current));
          throw e;
        });
      }
      last = this.toItem(j, current);
      this.folderCache.set(current, last);
      parentId = last.itemId;
    }
    if (!last) throw new Error("Empty folder path");
    return last;
  }

  async upload(folderRelPath: string, name: string, content: Buffer, contentType: string): Promise<StoredItem> {
    const folder = await this.ensureFolder(folderRelPath);
    const path = `${folderRelPath}/${name}`;
    const conflict = "@microsoft.graph.conflictBehavior=fail";
    if (content.length <= 4 * 1024 * 1024) {
      const j = await this.call(
        "PUT",
        `/drives/${this.opts.driveId}/items/${folder.itemId}:/${encodeURIComponent(name)}:/content?${conflict}`,
        content,
        { "Content-Type": contentType },
        true,
      );
      return this.toItem(j, path);
    }
    const session = await this.call("POST", `/drives/${this.opts.driveId}/items/${folder.itemId}:/${encodeURIComponent(name)}:/createUploadSession`, {
      item: { "@microsoft.graph.conflictBehavior": "fail" },
    });
    const chunk = 5 * 320 * 1024; // multiple of 320 KiB
    let j: any = null;
    for (let start = 0; start < content.length; start += chunk) {
      const end = Math.min(start + chunk, content.length);
      const res = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${start}-${end - 1}/${content.length}` },
        body: new Uint8Array(content.subarray(start, end)),
      });
      if (!res.ok) throw new Error(`Upload chunk failed: ${res.status}`);
      j = await res.json();
    }
    return this.toItem(j, path);
  }

  async setMetadata(item: StoredItem, meta: FileMetadata) {
    // Columns are created once by scripts/bootstrap-sharepoint.ts on the library.
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) if (v !== undefined && v !== null) fields[`GIT${k}`] = v;
    await this.call("PATCH", `/drives/${this.opts.driveId}/items/${item.itemId}/listItem/fields`, fields);
  }

  async list(folderRelPath: string) {
    const j = await this.call("GET", `${this.byPath(folderRelPath)}:/children?$top=999`);
    return (j?.value ?? []).map((x: any) => this.toItem(x, `${folderRelPath}/${x.name}`));
  }

  async download(itemId: string) {
    const r = await fetch(`https://graph.microsoft.com/v1.0/drives/${this.opts.driveId}/items/${itemId}/content`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!r.ok) throw new Error(`Download failed: ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
}
