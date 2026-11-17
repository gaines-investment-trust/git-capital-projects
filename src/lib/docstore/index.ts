import { env } from "../env";
import { GraphDocumentStore } from "./graph";
import { LocalDocumentStore } from "./local";
import type { DocumentStore } from "./types";

export type { DocumentStore, StoredItem, FileMetadata } from "./types";

let store: DocumentStore | null = null;

export function docStore(): DocumentStore {
  if (store) return store;
  const e = env();
  if (e.DOCSTORE === "graph") {
    if (!e.GRAPH_TENANT_ID || !e.GRAPH_CLIENT_ID || !e.SP_DRIVE_ID || !e.SP_ROOT_ITEM_ID) {
      throw new Error("DOCSTORE=graph needs GRAPH_TENANT_ID, GRAPH_CLIENT_ID, SP_DRIVE_ID and SP_ROOT_ITEM_ID");
    }
    store = new GraphDocumentStore({
      tenantId: e.GRAPH_TENANT_ID,
      clientId: e.GRAPH_CLIENT_ID,
      clientSecret: e.GRAPH_CLIENT_SECRET,
      driveId: e.SP_DRIVE_ID,
      rootItemId: e.SP_ROOT_ITEM_ID,
    });
  } else {
    store = new LocalDocumentStore(e.LOCAL_DOCSTORE_DIR);
  }
  return store;
}

/** Tests swap in their own store. */
export function setDocStore(s: DocumentStore | null) {
  store = s;
}
