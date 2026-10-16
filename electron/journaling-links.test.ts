import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkConnectLink, findConnectLink, parseConnectLink } from './journaling-links';

test('a connect link gives a normalised code and the platform origin', () => {
  assert.deepEqual(parseConnectLink('openterm5://journaling/connect?code=abcd-efgh&platform=https://tradescribe.io'), { code: 'ABCD-EFGH', platform: 'https://tradescribe.io' });
  assert.deepEqual(parseConnectLink('openterm5://journaling/connect/?code=ABCDEFGH&platform=https%3A%2F%2Ftradescribe.io%2F'), { code: 'ABCD-EFGH', platform: 'https://tradescribe.io' });
});

test('links of another shape are not connect links', () => {
  assert.equal(parseConnectLink('openterm5://journaling/other?code=ABCD-EFGH&platform=https://tradescribe.io'), null);
  assert.equal(parseConnectLink('openterm5://elsewhere/connect?code=ABCD-EFGH&platform=https://tradescribe.io'), null);
  assert.equal(parseConnectLink('https://journaling/connect?code=ABCD-EFGH&platform=https://tradescribe.io'), null);
  assert.equal(parseConnectLink('openterm5://journaling/connect?code=ABC&platform=https://tradescribe.io'), null);
  assert.equal(parseConnectLink('openterm5://journaling/connect?code=ABCD-EFGH'), null);
  assert.equal(parseConnectLink('not a url'), null);
});

test('the link is found among command-line arguments', () => {
  assert.equal(findConnectLink(['/opt/OpenTerm5/openterm5', '--no-sandbox', 'openterm5://journaling/connect?code=ABCD-EFGH&platform=https://tradescribe.io']), 'openterm5://journaling/connect?code=ABCD-EFGH&platform=https://tradescribe.io');
  assert.equal(findConnectLink(['electron', '.']), null);
});

test('a code for another platform is refused and names that platform', () => {
  const link = 'openterm5://journaling/connect?code=ABCD-EFGH&platform=https://journal.example.com';
  const refused = checkConnectLink(link, 'https://tradescribe.io');
  assert.equal(refused.isAccepted, false);
  assert.match(!refused.isAccepted ? refused.error : '', /https:\/\/journal\.example\.com.*https:\/\/tradescribe\.io.*Tools > Options/);
  assert.deepEqual(checkConnectLink(link, 'https://journal.example.com'), { isAccepted: true, link: { code: 'ABCD-EFGH', platform: 'https://journal.example.com' } });
  assert.equal(checkConnectLink('openterm5://journaling/connect', 'https://tradescribe.io').isAccepted, false);
});
