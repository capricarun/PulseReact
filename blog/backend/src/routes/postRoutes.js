const express = require('express');
const { body, param } = require('express-validator');

const pool = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { slugify, readMinutes, excerptOf } = require('../utils/text');

const router = express.Router();

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const slugParam = param('slug').isString().isLength({ min: 1, max: 280 }).withMessage('Invalid post');

// GET /api/posts?page=1&limit=9&tag=devops&search=eks  -> published posts, newest first
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 9), 1), 50);
    const offset = (page - 1) * limit;
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    let where = "WHERE p.status = 'published'";
    const params = {};
    if (tag) {
      where += ' AND p.tag = :tag';
      params.tag = tag;
    }
    if (search) {
      where += ' AND (p.title LIKE :search OR p.excerpt LIKE :search)';
      params.search = `%${search}%`;
    }

    const [rows] = await pool.query(
      `SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image, p.tag, p.read_minutes,
              p.created_at, u.name AS author_name
         FROM posts p JOIN users u ON u.id = p.author_id
         ${where}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT :limit OFFSET :offset`,
      { ...params, limit, offset }
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM posts p ${where}`, params);

    res.json({ data: rows, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/posts/:slug  -> one post with its comments. Drafts are visible to their author only.
router.get('/:slug', optionalAuth, [slugParam], validate, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS author_name
         FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.slug = :slug`,
      { slug: req.params.slug }
    );
    const post = rows[0];
    const isAuthor = Boolean(post && req.user && req.user.id === post.author_id);
    if (!post || (post.status !== 'published' && !isAuthor)) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const [comments] = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.name AS author_name
         FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.post_id = :postId
        ORDER BY c.created_at ASC, c.id ASC`,
      { postId: post.id }
    );
    return res.json({ ...post, comments });
  } catch (err) {
    return next(err);
  }
});

// POST /api/posts  (auth)  -> { id, slug }
router.post(
  '/',
  requireAuth,
  [
    body('title').isString().trim().isLength({ min: 3, max: 255 }).withMessage('Title must be 3-255 characters'),
    body('body').isString().trim().isLength({ min: 20, max: 100000 }).withMessage('Body must be at least 20 characters'),
    body('excerpt').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }).withMessage('Excerpt is too long'),
    body('tag').optional({ values: 'falsy' }).isString().trim().toLowerCase().isLength({ max: 60 }).withMessage('Tag is too long'),
    body('coverImage').optional({ values: 'falsy' }).isURL({ protocols: ['https'] }).withMessage('Cover image must be an https URL'),
    body('status').optional().isIn(['published', 'draft']).withMessage('Status must be published or draft'),
  ],
  validate,
  async (req, res, next) => {
    const { title, body: content, excerpt, tag, coverImage, status } = req.body;
    const slug = slugify(title);
    try {
      const [result] = await pool.query(
        `INSERT INTO posts (title, slug, body, excerpt, cover_image, tag, read_minutes, status, author_id)
         VALUES (:title, :slug, :body, :excerpt, :coverImage, :tag, :readMinutes, :status, :authorId)`,
        {
          title,
          slug,
          body: content,
          excerpt: excerpt || excerptOf(content),
          coverImage: coverImage || null,
          tag: tag || 'general',
          readMinutes: readMinutes(content),
          status: status || 'published',
          authorId: req.user.id,
        }
      );
      res.status(201).json({ id: result.insertId, slug });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/posts/:slug/comments  (auth)
router.post(
  '/:slug/comments',
  requireAuth,
  [slugParam, body('body').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('Comment must be 1-1000 characters')],
  validate,
  async (req, res, next) => {
    try {
      const [posts] = await pool.query('SELECT id, status, author_id FROM posts WHERE slug = :slug', {
        slug: req.params.slug,
      });
      const post = posts[0];
      if (!post || (post.status !== 'published' && post.author_id !== req.user.id)) {
        return res.status(404).json({ error: 'Post not found' });
      }
      const [result] = await pool.query(
        'INSERT INTO comments (post_id, author_id, body) VALUES (:postId, :authorId, :body)',
        { postId: post.id, authorId: req.user.id, body: req.body.body }
      );
      return res.status(201).json({ id: result.insertId, message: 'Comment added' });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
