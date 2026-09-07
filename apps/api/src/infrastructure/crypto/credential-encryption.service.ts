import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialDecryptionError } from './errors/credential-decryption.error';

/** AES-256-GCM encrypted payload. All parts base64-encoded. */
export interface EncryptedCredential {
  cipherText: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts/decrypts platform credentials with AES-256-GCM
 * (Sprint 0 task §22). The key comes from CREDENTIAL_ENCRYPTION_KEY
 * (32-byte hex). Wrong keys fail during authentication-tag verification.
 */
@Injectable()
export class CredentialEncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hex = config.getOrThrow<string>('app.credentialEncryptionKey');
    this.key = Buffer.from(hex, 'hex');
    if (this.key.byteLength !== 32) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars).');
    }
  }

  async encrypt(plainText: string): Promise<EncryptedCredential> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    return {
      cipherText: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  async decrypt(payload: EncryptedCredential): Promise<string> {
    try {
      const iv = Buffer.from(payload.iv, 'base64');
      const authTag = Buffer.from(payload.authTag, 'base64');
      const cipherText = Buffer.from(payload.cipherText, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
    } catch {
      // Never expose crypto internals; only that verification failed.
      throw new CredentialDecryptionError();
    }
  }
}
