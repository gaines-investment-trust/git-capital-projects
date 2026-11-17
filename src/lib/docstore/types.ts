/**
 * DocumentStore: the only way the app touches files (architecture 1.2).
 * Implementations: GraphDocumentStore (SharePoint, production) and LocalDocumentStore (dev/test).
 * The app stores only the returned ids and metadata, never the only copy of a file.
 */
export type StoredItem = {
  driveId: string;
  itemId: string;
  path: string; // relative to the main folder, "/" separated
  name: string;
  webUrl?: string;
  version?: string;
};

export type FileMetadata = {
  ProjectID?: string;
  Property?: string;
  DocType?: string;
  Vendor?: string;
  Status?: string;
  Amount?: number;
  DocDate?: string;
  OriginalFileName?: string;
};

export interface DocumentStore {
  /** Ensure every folder in `relPath` exists under the main folder; returns the last one. Idempotent. */
  ensureFolder(relPath: string): Promise<StoredItem>;
  /** Upload a new file. Fails if the name exists: callers bump the version instead (never overwrite). */
  upload(folderRelPath: string, name: string, content: Buffer, contentType: string): Promise<StoredItem>;
  exists(relPath: string): Promise<boolean>;
  setMetadata(item: StoredItem, meta: FileMetadata): Promise<void>;
  list(folderRelPath: string): Promise<StoredItem[]>;
}
