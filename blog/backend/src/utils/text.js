const crypto = require('node:crypto');

// "Shipping to EKS!" -> "shipping-to-eks-3f9a1c" (random suffix keeps slugs unique for identical titles)
function slugify(title) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
  return `${base || 'post'}-${crypto.randomBytes(3).toString('hex')}`;
}

// Roughly 200 words per minute, never less than one minute
function readMinutes(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function excerptOf(text, max = 160) {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

module.exports = { slugify, readMinutes, excerptOf };
