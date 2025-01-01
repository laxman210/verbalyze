const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const ms = require('ms');

// Environment variables
const USERS_TABLE = process.env.USERS_TABLE;
const TEMP_USERS_TABLE = process.env.TEMP_USERS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '1h';
const AWS_REGION = process.env.AWS_REGION;
const OTP_EXPIRY_TIME = 5 * 60; // 5 minutes in seconds

// DynamoDB setup
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

// SNS setup
const sns = new SNSClient({ region: AWS_REGION });

// Helper functions
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendSMS = async (mobile, otp) => {
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

    try {
        const command = new PublishCommand(params);
        const response = await sns.send(command);
        console.log('Message sent successfully:', JSON.stringify(response, null, 2));
        return true;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
};

// User Authentication Service
class UserAuthService {
    async register(userData) {
        const { firstName, lastName, email, phone } = userData;

        // Check if user already exists
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
            throw new Error('Email already registered.');
        }

        // Generate OTP and send SMS
        const otp = generateOtp();
        await sendSMS(phone, otp);

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

        return { userId, message: 'OTP sent to your mobile number. It will expire in 5 minutes.' };
    }

    async verifyOtp(verificationData) {
        const { userId, otp, password } = verificationData;

        // Retrieve temporary user data
        const getTempUserParams = new GetCommand({
            TableName: TEMP_USERS_TABLE,
            Key: { userId: userId }
        });

        const tempUserResult = await dynamoDB.send(getTempUserParams);
        const tempUser = tempUserResult.Item;

        if (!tempUser) {
            throw new Error('User not found. Please register again.');
        }

        const currentTime = Math.floor(Date.now() / 1000);
        if (currentTime > tempUser.expirationTime) {
            throw new Error('OTP has expired. Please request a new one.');
        }

        if (tempUser.otp !== otp) {
            throw new Error('Invalid OTP.');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

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

        return { message: 'OTP verified and user registered successfully.' };
    }

    async login(loginData) {
        const { email, password } = loginData;

        const params = new QueryCommand({
            TableName: USERS_TABLE,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        });

        const result = await dynamoDB.send(params);

        if (!result.Items || result.Items.length === 0) {
            throw new Error('Invalid credentials');
        }

        const user = result.Items[0];

        if (!user.password) {
            throw new Error('Invalid credentials');
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            throw new Error('Invalid credentials');
        }

        const token = jwt.sign(
            {
                userId: user.userId,
                email: user.email,
            },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        return { 
            message: 'Login successful', 
            userId: user.userId,
            token: token,
            tokenExpiry: ms(TOKEN_EXPIRY)
        };
    }
}

module.exports = new UserAuthService();
