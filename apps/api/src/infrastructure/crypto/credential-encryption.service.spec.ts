import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CredentialEncryptionService } from './credential-encryption.service';
import { CredentialDecryptionError } from './errors/credential-decryption.error';

function makeService(hexKey: string): CredentialEncryptionService {
  const config = {
    getOrThrow: (_key: string) => hexKey,
  } as unknown as ConfigService;
  return new CredentialEncryptionService(config);
}

const KEY = 'ab'.repeat(32);
const OTHER_KEY = 'cd'.repeat(32);

describe('CredentialEncryptionService (AES-256-GCM)', () => {
  it('roundtrips plain -> encrypt -> decrypt -> plain', async () => {
    const service = makeService(KEY);
    const plain = 'ozon-api-key-12345';
    const encrypted = await service.encrypt(plain);
    expect(encrypted.cipherText).not.toContain(plain);
    expect(await service.decrypt(encrypted)).toBe(plain);
  });

  it('produces different ciphertexts for the same input (random IV)', async () => {
    const service = makeService(KEY);
    const a = await service.encrypt('same-value');
    const b = await service.encrypt('same-value');
    expect(a.cipherText).not.toBe(b.cipherText);
    expect(a.iv).not.toBe(b.iv);
  });

  it('fails decryption with a wrong key (GCM auth tag)', async () => {
    const encrypter = makeService(KEY);
    const decrypter = makeService(OTHER_KEY);
    const encrypted = await encrypter.encrypt('secret-value');
    await expect(decrypter.decrypt(encrypted)).rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  it('fails decryption when the payload is corrupted', async () => {
    const service = makeService(KEY);
    const encrypted = await service.encrypt('secret-value');
    const corrupted = {
      ...encrypted,
      cipherText: Buffer.from('tampered').toString('base64'),
    };
    await expect(service.decrypt(corrupted)).rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => makeService('a'.repeat(63))).toThrow();
  });
});
