import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSamePlatform, normalizeCode, parsePlatformUrl } from './journaling';

test('platform addresses must be https, or http on this computer', () => {
  assert.equal(parsePlatformUrl(' https://tradescribe.io/ '), 'https://tradescribe.io');
  assert.equal(parsePlatformUrl('https://journal.example.com:8443'), 'https://journal.example.com:8443');
  assert.equal(parsePlatformUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(parsePlatformUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(parsePlatformUrl('http://[::1]:3000'), 'http://[::1]:3000');
  assert.throws(() => parsePlatformUrl('http://tradescribe.io'), /Use https/);
  assert.throws(() => parsePlatformUrl('http://192.168.1.5:3000'), /Use https/);
  assert.throws(() => parsePlatformUrl('ftp://tradescribe.io'), /https/);
  assert.throws(() => parsePlatformUrl('tradescribe.io'), /platform address/);
  assert.throws(() => parsePlatformUrl('https://user:pass@tradescribe.io'), /user name/);
  assert.throws(() => parsePlatformUrl('https://tradescribe.io/app'), /without a path/);
  assert.throws(() => parsePlatformUrl('https://tradescribe.io/?x=1'), /without a path/);
});

test('platforms compare by origin', () => {
  assert.equal(isSamePlatform('https://tradescribe.io/', 'https://tradescribe.io'), true);
  assert.equal(isSamePlatform('https://tradescribe.io', 'https://www.tradescribe.io'), false);
  assert.equal(isSamePlatform('https://tradescribe.io', 'not a url'), false);
});

test('codes are accepted with or without the hyphen, in any case', () => {
  assert.equal(normalizeCode('abcd-efgh'), 'ABCD-EFGH');
  assert.equal(normalizeCode(' ABCD EFGH '), 'ABCD-EFGH');
  assert.equal(normalizeCode('ABCDEFGH'), 'ABCD-EFGH');
  assert.equal(normalizeCode('ABCD-EFG'), null);
  assert.equal(normalizeCode('ABCD-EFGH-1'), null);
  assert.equal(normalizeCode('ABCD_EFGH'), null);
});
