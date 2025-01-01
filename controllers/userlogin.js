const dynamoDB = require('../config/dynamoDB');
const { QueryCommand, ScanCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const ms = require('ms');
const winston = require('winston');
require('dotenv').config();

// Environment variables for security
const USERS_TABLE = process.env.USERS_TABLE;
const TEMP_USERS_TABLE = process.env.TEMP_USERS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '1h';
const OTP_EXPIRY_TIME = 5 * 60; // 5 minutes in seconds

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

// AWS SNS setup
const sns = new SNSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// Helper functions
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendSMSMessage = async (sns, params) => {
    const command = new PublishCommand(params);
    return await sns.send(command);
};

const sendSMS = async (mobile, message) => {
    // Validate phone number format
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(mobile)) {
        console.error('Invalid phone number format');
        throw new Error('Invalid phone number format. Please use the format: +[country code][number]');
    }
    
    const params = {
        Message: message,
        PhoneNumber: mobile,
        MessageAttributes: {
            'AWS.SNS.SMS.SenderID': {
                DataType: 'String',
                StringValue: 'verbalyze'
            },
            'AWS.SNS.SMS.SMSType': {
                DataType: 'String',
                StringValue: 'Transactional'
            }
        }
    };

    try {
        const response = await sendSMSMessage(sns, params);
        logger.info('Message sent successfully:', { response, senderID: 'verbalyze' });
        return true;
    } catch (error) {
        logger.error('Error sending message:', { error: error.message, name: error.name, senderID: 'verbalyze' });
        if (error.name === 'InvalidParameterException') {
            logger.error('Invalid parameter. Check your phone number format, message content, or sender ID.');
        } else if (error.name === 'InvalidClientTokenId') {
            logger.error('Invalid AWS credentials. Check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
        } else if (error.name === 'SignatureDoesNotMatch') {
            logger.error('AWS credential signature mismatch. Ensure your AWS_SECRET_ACCESS_KEY is correct.');
        } else if (error.name === 'AuthorizationErrorException') {
            logger.error('Authorization error. Ensure your AWS account has permission to send SMS.');
        } else {
            logger.error('Unexpected error:', { error: error.message });
        }
        throw error;
    }
};

const forgotPassword = async (req, res) => {
    try {
        const { emailOrPhone } = req.body;

        if (!emailOrPhone) {
            return res.status(400).json({ message: 'Email or phone number is required.' });
        }

        // Check if the input is an email or phone number
        const isEmail = emailOrPhone.includes('@');
        const queryParams = isEmail
            ? {
                TableName: USERS_TABLE,
                IndexName: 'EmailIndex',
                KeyConditionExpression: 'email = :emailOrPhone',
                ExpressionAttributeValues: { ':emailOrPhone': emailOrPhone }
              }
            : {
                TableName: USERS_TABLE,
                FilterExpression: 'phone = :emailOrPhone',
                ExpressionAttributeValues: { ':emailOrPhone': emailOrPhone }
              };

        const command = isEmail ? new QueryCommand(queryParams) : new ScanCommand(queryParams);
        const result = await dynamoDB.send(command);

        if (!result.Items || result.Items.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const user = result.Items[0];
        const otp = generateOtp();
        const expirationTime = Math.floor(Date.now() / 1000) + OTP_EXPIRY_TIME;

        // Store OTP in temporary table
        const storeOtpParams = new PutCommand({
            TableName: TEMP_USERS_TABLE,
            Item: {
                userId: user.userId,
                otp,
                expirationTime,
                purpose: 'PASSWORD_RESET'
            }
        });

        await dynamoDB.send(storeOtpParams);

        // Always send OTP via SMS to the user's phone number
        if (user.phone) {
            try {
                await sendSMS(user.phone, `Your OTP for password reset is: ${otp}`);
                res.status(200).json({ 
                    message: 'OTP sent to your registered phone number. It will expire in 5 minutes.',
                    userId: user.userId
                });
            } catch (smsError) {
                logger.error('SMS Error:', { error: smsError.message, stack: smsError.stack });
                res.status(500).json({ message: 'Failed to send OTP. Please try again later.' });
            }
        } else {
            res.status(400).json({ message: 'No phone number associated with this account. Please contact support.' });
        }

    } catch (error) {
        logger.error('Forgot Password Error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'An error occurred while processing your request. Please try again later.' });
    }
};

const resetPassword = async (req, res) => {
    try {
        const { userId, otp, newPassword } = req.body;

        if (!userId || !otp || !newPassword) {
            return res.status(400).json({ message: 'User ID, OTP, and new password are required.' });
        }

        // Retrieve OTP data
        const getOtpParams = new GetCommand({
            TableName: TEMP_USERS_TABLE,
            Key: { userId: userId }
        });

        const otpResult = await dynamoDB.send(getOtpParams);
        const otpData = otpResult.Item;

        if (!otpData || otpData.purpose !== 'PASSWORD_RESET') {
            return res.status(400).json({ message: 'Invalid or expired OTP.' });
        }

        const currentTime = Math.floor(Date.now() / 1000);
        if (currentTime > otpData.expirationTime) {
            return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
        }

        if (otpData.otp !== otp) {
            return res.status(400).json({ message: 'Invalid OTP.' });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update user's password
        const updateUserParams = new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: userId },
            UpdateExpression: 'SET password = :newPassword',
            ExpressionAttributeValues: {
                ':newPassword': hashedPassword
            }
        });

        await dynamoDB.send(updateUserParams);

        // Delete the OTP data
        const deleteOtpParams = new DeleteCommand({
            TableName: TEMP_USERS_TABLE,
            Key: { userId: userId }
        });

        await dynamoDB.send(deleteOtpParams);

        res.status(200).json({ message: 'Password reset successfully.' });
    } catch (error) {
        logger.error('Reset Password Error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'An error occurred while resetting the password. Please try again later.' });
    }
};

// Apply rate limiting and input validation to login route
loginUser.middlewares = [loginLimiter, validateLoginInput];

// Apply rate limiting to forgotPassword
forgotPassword.middlewares = [rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // limit each IP to 3 forgot password attempts per windowMs
    message: 'Too many forgot password attempts, please try again later.'
})];

module.exports = {
    loginUser,
    forgotPassword,
    resetPassword
};
