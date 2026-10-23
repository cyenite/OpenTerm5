import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { HubCrypto } from '../../shared/hub-session';

// Pure JavaScript, because a phone that loads the client from the computer over plain HTTP is not
// a secure context and has no WebCrypto. The output matches node:crypto's AES-256-GCM.
export const browserHubCrypto: HubCrypto = {
  random: (length) => randomBytes(length),
  sha256: async (data) => sha256(data),
  async generateKeyPair() {
    const privateKey = x25519.utils.randomSecretKey();
    return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
  },
  dh: async (privateKey, publicKey) => x25519.getSharedSecret(privateKey, publicKey),
  hkdf: async (ikm, salt, info, length) => hkdf(sha256, ikm, salt, info, length),
  seal: async (key, nonce, plaintext) => gcm(key, nonce).encrypt(plaintext),
  open: async (key, nonce, ciphertext) => gcm(key, nonce).decrypt(ciphertext),
};
