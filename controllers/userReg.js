// Import required modules
const dynamoDB = require('../config/dynamoDB');
const { PutCommand, GetCommand, UpdateCommand, ScanCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const winston = require('winston');
require('dotenv').config();

// Environment variables for security
const USERS_TABLE = process.env.USERS_TABLE;
const TEMP_USERS_TABLE = process.env.TEMP_USERS_TABLE;
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

if (!USERS_TABLE || !TEMP_USERS_TABLE) {
    logger.error('Missing required environment variables');
    process.exit(1);
}

// AWS SNS setup
const sns = new SNSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// Rate limiting setup
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // limit each IP to 3 registration attempts per windowMs
    message: 'Too many registration attempts, please try again later.'
});

// Input validation middleware
const validateRegistrationInput = [
    body('firstName').trim().isLength({ min: 2 }),
    body('lastName').trim().isLength({ min: 2 }),
    body('email').isEmail().normalizeEmail(),
    body('phone').isMobilePhone()
];
// Helper functions
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendSMSMessage = async (sns, params) => {
    const command = new PublishCommand(params);
    return await sns.send(command);
};

const sendSMS = async (mobile, otp) => {
    // Validate phone number format
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(mobile)) {
        console.error('Invalid phone number format');
        throw new Error('Invalid phone number format. Please use the format: +[country code][number]');
    }
    
    const params = {
        Message: `Your OTP is: ${otp}`,
        PhoneNumber: mobile,
        MessageAttributes: {
            'AWS.SNS.SMS.SenderID': {
                DataType: 'String',
                StringValue: 'Verbalyze'
            }
        }
    };

    // Create an SNS client instance
    const sns = new SNSClient({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    try {
        // Call the sendSMSMessage function with the correct parameters
        const response = await sendSMSMessage(sns, params);
        logger.info('Message sent successfully:', { response });
        return true;
    } catch (error) {
        logger.error('Error sending message:', { error: error.message, name: error.name });
        if (error.name === 'InvalidParameterException') {
            logger.error('Invalid parameter. Check your phone number format and message content.');
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
}

// Registration functions
const register = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { firstName, lastName, email, phone } = req.body;

        // Check if user already exists in DynamoDB using GSI
        const checkParams = new QueryCommand({
            TableName: USERS_TABLE,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        });
        
        const existingUser = await dynamoDB.send(checkParams);

        if (existingUser.Items && existingUser.Items.length > 0) {
            return res.status(409).json({ message: 'Email already registered.' });
        }

        // Generate OTP and send SMS
        const otp = generateOtp();
        
        try {
            await sendSMS(phone, otp);
        } catch (smsError) {
        logger.error('SMS Error:', { error: smsError });
            return res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
        }

        // Generate userId
        const userId = (firstName.substring(0, 2) + lastName.substring(0, 2) + phone.slice(-4)).toUpperCase();

        // Store user data in temporary DynamoDB table
        const expirationTime = Math.floor(Date.now() / 1000) + OTP_EXPIRY_TIME;
        const tempUserItem = new PutCommand({
            TableName: TEMP_USERS_TABLE,
            Item: {
                userId,
                firstName,
                lastName,
                email,
                phone,
                otp,
                expirationTime
            }
        });

        await dynamoDB.send(tempUserItem);

        res.status(200).json({ 
            message: 'OTP sent to your mobile number. It will expire in 5 minutes.', 
            userId
        });
    } catch (error) {
        logger.error('Registration Error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'An error occurred during registration. Please try again later.' });
    }
};

// Apply rate limiting and input validation to register route
register.middlewares = [registerLimiter, validateRegistrationInput];

const verifyOtp = async (req, res) => {
    try {
        const { userId, otp, password, confirmPassword } = req.body;

        const missingFields = [];
        if (!userId) missingFields.push('userId');
        if (!otp) missingFields.push('otp');
        if (!password) missingFields.push('password');
        if (!confirmPassword) missingFields.push('confirmPassword');

        if (missingFields.length > 0) {
            return res.status(400).json({ 
                message: 'All fields are required.', 
                missingFields: missingFields 
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match.' });
        }

        // Retrieve temporary user data
        const getTempUserParams = new GetCommand({
            TableName: TEMP_USERS_TABLE,
            Key: { userId: userId }
        });

        const tempUserResult = await dynamoDB.send(getTempUserParams);
        const tempUser = tempUserResult.Item;

        if (!tempUser) {
            return res.status(404).json({ message: 'User not found. Please register again.' });
        }

        const currentTime = Math.floor(Date.now() / 1000);
        if (currentTime > tempUser.expirationTime) {
            return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
        }

        if (tempUser.otp !== otp) {
            return res.status(400).json({ message: 'Invalid OTP.' });
        }

        let hashedPassword;
        try {
            hashedPassword = await bcrypt.hash(password, 10);
        } catch (bcryptError) {
            throw new Error('Error processing password');
        }

        const userItem = new PutCommand({
            TableName: USERS_TABLE,
            Item: {
                userId: tempUser.userId,
                firstName: tempUser.firstName,
                lastName: tempUser.lastName,
                email: tempUser.email,
                phone: tempUser.phone,
                password: hashedPassword,
                createdAt: new Date().toISOString(),
            },
        });

        await dynamoDB.send(userItem);

        // Delete temporary user data
        const deleteTempUserParams = new DeleteCommand({
            TableName: TEMP_USERS_TABLE,
            Key: { userId: userId }
        });

        await dynamoDB.send(deleteTempUserParams);

        res.status(200).json({ message: 'OTP verified and user registered successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

const saveCompanyDetails = async (req, res) => {
    try {
        const { userId, organisation, industry, size, website } = req.body;
        logger.debug('Request body:', { body: req.body });

        if (!userId) {
            return res.status(400).json({ message: 'User ID is required.' });
        }

        logger.debug('Company details:', { organisation, industry, size, website });

        // Find the user by userId
        const scanParams = new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': userId
            }
        });
        const result = await dynamoDB.send(scanParams);

        if (!result.Items || result.Items.length === 0) {
            logger.warn(`User not found for userId: ${userId}`);
            return res.status(404).json({ message: 'User not found.' });
        }

        const user = result.Items[0];

        // Prepare the update expression and attribute values
        let updateExpression = 'SET';
        const expressionAttributeValues = {};
        const expressionAttributeNames = {};

        if (organisation !== undefined) {
            updateExpression += ' #on = :on,';
            expressionAttributeNames['#on'] = 'organisation';
            expressionAttributeValues[':on'] = organisation;
        }
        if (industry !== undefined) {
            updateExpression += ' #ind = :ind,';
            expressionAttributeNames['#ind'] = 'industry';
            expressionAttributeValues[':ind'] = industry;
        }
        if (size !== undefined) {
            updateExpression += ' #sz = :sz,';
            expressionAttributeNames['#sz'] = 'size';
            expressionAttributeValues[':sz'] = size;
        }
        if (website !== undefined) {
            updateExpression += ' #ws = :ws,';
            expressionAttributeNames['#ws'] = 'website';
            expressionAttributeValues[':ws'] = website;
        }

        // Remove trailing comma
        updateExpression = updateExpression.slice(0, -1);

        // If no fields to update, return success
        if (Object.keys(expressionAttributeValues).length === 0) {
            return res.status(200).json({ message: 'No company details to update.' });
        }

        // Update user with the company details
        const updateParams = new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: user.userId },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ExpressionAttributeNames: expressionAttributeNames
        });

        await dynamoDB.send(updateParams);
        logger.info('Company details saved successfully', { userId: user.userId });

        res.status(200).json({
            message: 'Company details saved successfully.',
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone
        });
    } catch (error) {
        logger.error('Error during saving company details:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Internal Server Error.' });
    }
};


module.exports = {
    // Authentication functions
    register,
    verifyOtp,
    
    // User management functions
    saveCompanyDetails,
};
