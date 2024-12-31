const { body, validationResult } = require('express-validator');

const validateLoginInput = [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

const validateRegistrationInput = [
    body('firstName').trim().isLength({ min: 2 }),
    body('lastName').trim().isLength({ min: 2 }),
    body('email').isEmail().normalizeEmail(),
    body('phone').isMobilePhone(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

module.exports = {
    validateLoginInput,
    validateRegistrationInput
};
