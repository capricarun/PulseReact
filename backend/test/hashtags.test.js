const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractHashtags } = require('../src/utils/hashtags');

test('extracts hashtags without the # and lower-cases them', () => {
  assert.deepEqual(extractHashtags('Deploying to #EKS with #DevOps'), ['eks', 'devops']);
});

test('removes duplicate hashtags', () => {
  assert.deepEqual(extractHashtags('#k8s #K8s #k8s'), ['k8s']);
});

test('returns an empty list when there are no hashtags', () => {
  assert.deepEqual(extractHashtags('just a normal post'), []);
});

test('supports underscores and digits', () => {
  assert.deepEqual(extractHashtags('#ci_cd #web3'), ['ci_cd', 'web3']);
});
