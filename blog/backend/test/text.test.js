const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slugify, readMinutes, excerptOf } = require('../src/utils/text');

test('slugify makes URL-safe, unique slugs', () => {
  const a = slugify('  Hello, World! EKS & You  ');
  assert.match(a, /^hello-world-eks-you-[0-9a-f]{6}$/);
  assert.notEqual(a, slugify('  Hello, World! EKS & You  '));
  assert.match(slugify('???'), /^post-[0-9a-f]{6}$/);
});

test('readMinutes is at least one minute at ~200 words per minute', () => {
  assert.equal(readMinutes('one two three'), 1);
  assert.equal(readMinutes(Array(1000).fill('w').join(' ')), 5);
});

test('excerptOf keeps short text and trims long text with an ellipsis', () => {
  assert.equal(excerptOf('  Short   text '), 'Short text');
  const long = excerptOf('a '.repeat(200), 20);
  assert.equal(long.length <= 20, true);
  assert.ok(long.endsWith('…'));
});
