/**
 * Sync wire format.
 *
 * The server is deliberately dumb: it stores opaque ciphertext keyed by blob
 * id, with a server-assigned monotonic `revision` used as the pull cursor, and
 * a compare-and-swap `baseRevision` on write.
 */

export type BlobType = 'session' | 'tag' | 'bookmarkTree' | 'keys';

/** A blob as it travels over the wire (ciphertext only). */
export interface WireBlob {
  id: string;
  type: BlobType;
  /** Server-assigned; 0 for a blob that has never been pushed. */
  revision: number;
  /** Client timestamp; bound into the ciphertext AAD. */
  updatedAt: number;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  /** Which device wrote this revision. */
  deviceId?: string;
}

export interface PullResponse {
  blobs: WireBlob[];
  revision: number;
  hasMore?: boolean;
}

export interface PushResponse {
  id: string;
  revision: number;
}

export interface PairResponse {
  deviceId: string;
  token: string;
  serverVersion: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  blobs?: number;
}

export interface SyncConnector {
  ping(): Promise<HealthResponse | null>;
  pair(pairingSecret: string, deviceName: string): Promise<PairResponse>;
  pull(since: number): Promise<PullResponse>;
  push(blob: {
    id: string;
    type: BlobType;
    baseRevision: number;
    updatedAt: number;
    ciphertext: string;
    iv: string;
    deleted?: boolean;
  }): Promise<PushResponse>;
  remove(id: string): Promise<void>;
  me(): Promise<{ deviceId: string; name: string; revision: number }>;
}

export class SyncHttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'SyncHttpError';
    this.status = status;
    this.body = body;
  }
}
