import type { EncryptedBlob, SyncConnector } from './connector';

// TODO(M4): Implement VPS HTTP connector.
export class VpsConnector implements SyncConnector {
  async pull(_cursor: number | null): Promise<{ blobs: EncryptedBlob[]; latestVersion: number }> {
    throw new Error('not implemented');
  }

  async push(_blobs: EncryptedBlob[]): Promise<{ rejected: string[] }> {
    throw new Error('not implemented');
  }

  async ping(): Promise<boolean> {
    throw new Error('not implemented');
  }
}