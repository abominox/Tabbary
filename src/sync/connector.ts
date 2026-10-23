// Sync connector abstraction. See PLAN §11.
// TODO(M4): Implement VpsConnector, Crypto, and Engine.

export interface EncryptedBlob {
  id: string;
  type: 'session' | 'tag' | 'bookmarkTree';
  version: number;
  ciphertext: ArrayBuffer;
  nonce: Uint8Array;
  updatedAt: number;
  activeDevice?: string;
  activeHeartbeat?: number;
}

export interface SyncConnector {
  pull(cursor: number | null): Promise<{ blobs: EncryptedBlob[]; latestVersion: number }>;
  push(blobs: EncryptedBlob[]): Promise<{ rejected: string[] }>;
  ping(): Promise<boolean>;
}