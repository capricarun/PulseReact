const { validationResult } = require('express-validator');

// Runs after express-validator chains: answers 400 with the first message, in the same { error } shape as other errors.
function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = result.array();
  return res.status(400).json({ error: errors[0].msg, errors });
}

module.exports = { validate };
