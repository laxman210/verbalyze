const dynamoDB = require('../config/dynamoDB');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const ms = require('ms');
const winston = require('winston');
require('dotenv').config();

// Environment variables for security
const USERS_TABLE = process.env.USERS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '1h';

// Setup Winston logger
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'user-service' },
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Rate limiting setup
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 login attempts per windowMs
    message: 'Too many login attempts, please try again later.'
});

// Input validation middleware
const validateLoginInput = [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 })
];

const loginUser = async (req, res) => {
    try {
        logger.info('Login attempt started');
        // Input validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn('Validation errors:', errors.array());
            return res.status(400).json({ message: 'Invalid input', errors: errors.array() });
        }

        const { email, password } = req.body;
        logger.info(`Login attempt for email: ${email}`);

        const params = new QueryCommand({
            TableName: USERS_TABLE,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        });

        const result = await dynamoDB.send(params);
        logger.info('DynamoDB query result:', result);

        if (!result.Items || result.Items.length === 0) {
            logger.warn('No user found with the provided email');
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = result.Items[0];

        if (!user.password) {
            logger.warn('User has no password set');
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            logger.warn('Password does not match');
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            {
                userId: user.userId,
                email: user.email,
            },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );
        logger.info('JWT generated');

        // Set JWT in cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: ms(TOKEN_EXPIRY), // Convert to milliseconds
        });

        logger.info('Login successful');
        return res.status(200).json({ message: 'Login successful', userId: user.userId });

    } catch (error) {
        logger.error('Error during login:', error);
        return res.status(500).json({ message: 'An error occurred during login. Please try again later.' });
    }
};

// Apply rate limiting and input validation to login route
loginUser.middlewares = [loginLimiter, validateLoginInput];

module.exports = {
    loginUser
};
