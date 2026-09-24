const express = require('express');
const bcrypt = require('bcrypt');
const { body } = require('express-validator');

const pool = require('../config/db');
const { signToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

router.post(
  '/register',
  authLimiter,
  [
    body('name').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Name must be 2-120 characters'),
    body('email').isEmail().withMessage('Enter a valid email').normalizeEmail(),
    body('password').isString().isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  async (req, res, next) => {
    const { name, email, password } = req.body;
    try {
      const [existing] = await pool.query('SELECT id FROM users WHERE email = :email', { email });
      if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const [result] = await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :passwordHash)',
        { name, email, passwordHash }
      );
      const user = { id: result.insertId, name, email };
      return res.status(201).json({ token: signToken(user), user });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Enter a valid email').normalizeEmail(),
    body('password').isString().notEmpty().withMessage('Password is required'),
  ],
  validate,
  async (req, res, next) => {
    const { email, password } = req.body;
    try {
      const [rows] = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = :email', {
        email,
      });
      // Same message whether the email exists or not, so accounts cannot be enumerated
      const row = rows[0];
      const match = row ? await bcrypt.compare(password, row.password_hash) : false;
      if (!match) return res.status(401).json({ error: 'Invalid email or password' });

      const user = { id: row.id, name: row.name, email: row.email };
      return res.json({ token: signToken(user), user });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
