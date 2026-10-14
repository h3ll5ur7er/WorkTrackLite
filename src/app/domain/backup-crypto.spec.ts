import { WrongPasswordError, cryptoAvailable, decryptBackup, encryptBackup, isEncryptedBackup } from './backup-crypto';

// Few iterations keep the tests fast; the format stores the count, so decryption is unaffected.
const FAST = 1_000;
const PLAIN = JSON.stringify({ app: 'worktracklite', formatVersion: 2, nodes: [{ name: 'Zürich ✓' }] });

describe('backup encryption', () => {
  it('is available in the test environment', () => {
    expect(cryptoAvailable()).toBe(true);
  });

  it('round-trips with the right password and hides the content', async () => {
    const enc = await encryptBackup(PLAIN, 'correct horse', FAST);
    expect(isEncryptedBackup(enc)).toBe(true);
    expect(enc).not.toContain('Zürich');
    expect(JSON.parse(enc)).toMatchObject({ app: 'worktracklite', encrypted: 1, kdf: { name: 'PBKDF2', iterations: FAST } });
    expect(await decryptBackup(enc, 'correct horse')).toBe(PLAIN);
  });

  it('uses a fresh salt and IV every time', async () => {
    const [a, b] = [JSON.parse(await encryptBackup(PLAIN, 'pw', FAST)), JSON.parse(await encryptBackup(PLAIN, 'pw', FAST))];
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('rejects a wrong password and tampered data', async () => {
    const enc = await encryptBackup(PLAIN, 'pw', FAST);
    await expect(decryptBackup(enc, 'PW')).rejects.toBeInstanceOf(WrongPasswordError);
    const f = JSON.parse(enc);
    const bytes = atob(f.data);
    f.data = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    await expect(decryptBackup(JSON.stringify(f), 'pw')).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(decryptBackup(JSON.stringify({ ...JSON.parse(enc), data: '%%%' }), 'pw')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('treats differently composed Unicode passwords as the same', async () => {
    const enc = await encryptBackup(PLAIN, 'Café', FAST);
    expect(await decryptBackup(enc, 'Café')).toBe(PLAIN);
  });

  it('refuses unknown or absurd parameters instead of hanging', async () => {
    const f = JSON.parse(await encryptBackup(PLAIN, 'pw', FAST));
    for (const kdf of [
      { ...f.kdf, iterations: 1e12 },
      { ...f.kdf, iterations: 1 },
      { ...f.kdf, hash: 'MD5' },
    ]) {
      await expect(decryptBackup(JSON.stringify({ ...f, kdf }), 'pw')).rejects.toThrow('does not support');
    }
  });

  it('requires a password and recognises only its own envelope', async () => {
    await expect(encryptBackup(PLAIN, '')).rejects.toThrow('password');
    expect(isEncryptedBackup(PLAIN)).toBe(false);
    expect(isEncryptedBackup('not json')).toBe(false);
    expect(isEncryptedBackup('null')).toBe(false);
  });
});
