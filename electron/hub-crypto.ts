import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import type { HubCrypto } from '../shared/hub-session';

// Electron's BoringSSL has no ChaCha20-Poly1305 in node:crypto, so the channel uses AES-256-GCM.
const TAG_BYTES = 16;
const spkiPrefix = Buffer.from('302a300506032b656e032100', 'hex');
const pkcs8Prefix = Buffer.from('302e020100300506032b656e04220420', 'hex');

const publicKeyObject = (key: Uint8Array) => createPublicKey({ key: Buffer.concat([spkiPrefix, key]), format: 'der', type: 'spki' });
const privateKeyObject = (key: Uint8Array) => createPrivateKey({ key: Buffer.concat([pkcs8Prefix, key]), format: 'der', type: 'pkcs8' });

export const nodeHubCrypto: HubCrypto = {
  random: (length) => new Uint8Array(randomBytes(length)),
  sha256: async (data) => new Uint8Array(createHash('sha256').update(data).digest()),
  async generateKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    return {
      publicKey: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(spkiPrefix.length)),
      privateKey: new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(pkcs8Prefix.length)),
    };
  },
  dh: async (privateKey, publicKey) => new Uint8Array(diffieHellman({ privateKey: privateKeyObject(privateKey), publicKey: publicKeyObject(publicKey) })),
  hkdf: async (ikm, salt, info, length) => new Uint8Array(hkdfSync('sha256', ikm, salt, info, length)),
  async seal(key, nonce, plaintext) {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]));
  },
  async open(key, nonce, ciphertext) {
    if (ciphertext.length < TAG_BYTES) throw new Error('Frame too short');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_BYTES));
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - TAG_BYTES)), decipher.final()]));
  },
};
