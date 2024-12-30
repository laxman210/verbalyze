console.log('Loading blogController.js');
const dynamoDB = require('../config/dynamoDB');
const { uploadImageToS3 } = require('../config/s3');
const docs = require('../config/googleAuth');
const { PutCommand, GetCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch').default;
const cheerio = require('cheerio');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Environment variables for security
const USERS_TABLE = process.env.USERS_TABLE || 'users';
const BLOGPOST_TABLE = process.env.BLOGPOST_TABLE || 'BlogsPost';
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const TOKEN_EXPIRY = '1h';


const createBlogPostFromGoogleDoc = async (req, res) => {
  const { title, author, docId } = req.body;

  try {
    const postId = uuidv4(); 
    const createdAt = new Date().toISOString(); 
    let blogContent = ''; 
    const imageUrls = []; 
    let currentListType = null; 
    let currentNestingLevel = -1; 


    console.log(`Fetching Google Doc content for docId: ${docId}`);
    const doc = await docs.documents.get({ documentId: docId });
    console.log(JSON.stringify(doc.data, null, 2));


    const positionedObjects = doc.data.positionedObjects;
    if (positionedObjects) {
      for (const [objectId, positionedObject] of Object.entries(positionedObjects)) {
        const embeddedObject = positionedObject.positionedObjectProperties.embeddedObject;
        if (embeddedObject && embeddedObject.imageProperties && embeddedObject.imageProperties.contentUri) {
          const imageUrl = embeddedObject.imageProperties.contentUri;
          console.log(`Found image with objectId: ${objectId}, URL: ${imageUrl}`);

       
          const imageBuffer = await fetch(imageUrl).then(res => {
            if (res.ok) {
              return res.buffer();
            }
            throw new Error(`Failed to fetch image: ${imageUrl}`);
          });

      
          const imageKey = `blog_images/${postId}_${uuidv4()}.png`;
          const s3ImageUrl = await uploadImageToS3(imageBuffer, imageKey);
          imageUrls.push(s3ImageUrl);

       
          blogContent += `<img src="${s3ImageUrl}" alt="Blog Image"/>`;
        }
      }
    }


    const inlineObjects = doc.data.inlineObjects;
    if (inlineObjects) {
      for (const [objectId, inlineObject] of Object.entries(inlineObjects)) {
        const embeddedObject = inlineObject.inlineObjectProperties.embeddedObject;
        if (embeddedObject && embeddedObject.imageProperties && embeddedObject.imageProperties.sourceUri) {
          const imageUrl = embeddedObject.imageProperties.sourceUri;
          console.log(`Found inline image with objectId: ${objectId}, URL: ${imageUrl}`);

          
          const imageBuffer = await fetch(imageUrl).then(res => {
            if (res.ok) {
              return res.buffer();
            }
            throw new Error(`Failed to fetch inline image: ${imageUrl}`);
          });

          const imageKey = `blog_images/${postId}_${uuidv4()}.png`;
          const s3ImageUrl = await uploadImageToS3(imageBuffer, imageKey);
          imageUrls.push(s3ImageUrl); 

          blogContent += `<img src="${s3ImageUrl}" alt="Blog Image"/>`;
        }
      }
    }

    
    const content = doc.data.body.content;
    const lists = doc.data.lists || {};

    for (const element of content) {
      if (element.paragraph) {
        const paragraphStyle = element.paragraph.paragraphStyle || {};

      
        const indentStart = paragraphStyle.indentStart ? `${paragraphStyle.indentStart.magnitude}px` : '0px';
        const indentFirstLine = paragraphStyle.indentFirstLine ? `${paragraphStyle.indentFirstLine.magnitude}px` : '0px';
        const paragraphIndent = indentFirstLine !== '0px' ? indentFirstLine : indentStart;

       
        if (element.paragraph.bullet) {
          const listId = element.paragraph.bullet.listId;
          const listProperties = lists[listId]?.listProperties;
          const nestingLevel = element.paragraph.bullet.nestingLevel || 0;  
          const bulletInfo = listProperties?.nestingLevels[nestingLevel];

 
          const bulletType = bulletInfo?.glyphType === 'DECIMAL' ? 'ordered' : 'unordered';
          let bulletSymbol;

         
          if (bulletInfo?.glyphType === 'DECIMAL') {
            bulletSymbol = 'decimal';
          } else if (bulletInfo?.glyphType === 'ALPHA') {
            bulletSymbol = 'lower-alpha';
          } else if (bulletInfo?.glyphType === 'ROMAN') {
            bulletSymbol = 'lower-roman';
          } else {
            bulletSymbol = bulletInfo?.glyphSymbol || 'disc';
          }

          
          if (!currentListType || currentListType !== bulletType || currentNestingLevel !== nestingLevel) {
            if (currentListType) {
              blogContent += currentListType === 'ordered' ? '</ol>' : '</ul>';
            }
            currentListType = bulletType;
            currentNestingLevel = nestingLevel;

      
            if (currentListType === 'ordered') {
              blogContent += `<ol type="${bulletInfo.glyphFormat ? bulletInfo.glyphFormat.replace('%', '') : '1'}" style="list-style-type:${bulletSymbol}; margin-left:${paragraphIndent};">`;
            } else {
              blogContent += `<ul style="list-style-type:${bulletSymbol}; margin-left:${paragraphIndent};">`;
            }
          }

          blogContent += `<li>`;
        } else {
 
          if (currentListType) {
            blogContent += currentListType === 'ordered' ? '</ol>' : '</ul>';
            currentListType = null;
            currentNestingLevel = -1;
          }


          let alignment = 'left';
          if (paragraphStyle.alignment) {
            switch (paragraphStyle.alignment) {
              case 'CENTER':
                alignment = 'center';
                break;
              case 'RIGHT':
                alignment = 'right';
                break;
              default:
                alignment = 'left';
            }
          }


          if (element.paragraph.elements.length === 1 && !element.paragraph.elements[0].textRun.content.trim()) {
            blogContent += `<p style="text-align: ${alignment}; margin-left:${paragraphIndent}">&nbsp;</p>`;
          } else {
            blogContent += `<p style="text-align: ${alignment}; margin-left:${paragraphIndent}">`;
          }
        }


        for (const el of element.paragraph.elements) {
          if (el.textRun && el.textRun.content.trim()) {
            const text = el.textRun.content; 
            const textStyle = el.textRun.textStyle || {};

            let styledText = text;
            const styleAttributes = [];

   
            if (textStyle.bold) styledText = `<strong>${styledText}</strong>`;
            if (textStyle.italic) styledText = `<em>${styledText}</em>`;
            if (textStyle.underline) styledText = `<u>${styledText}</u>`;


            if (textStyle.fontSize?.magnitude) {
              styleAttributes.push(`font-size:${textStyle.fontSize.magnitude}px`);
            }


            if (textStyle.foregroundColor) {
              const color = textStyle.foregroundColor.color?.rgbColor;
              if (color) {
                const red = color.red ? Math.round(color.red * 255) : 0;
                const green = color.green ? Math.round(color.green * 255) : 0;
                const blue = color.blue ? Math.round(color.blue * 255) : 0;
                const rgbColor = `rgb(${red}, ${green}, ${blue})`;
                styleAttributes.push(`color:${rgbColor}`);
              }
            }


            if (textStyle.weightedFontFamily?.fontFamily) {
              styleAttributes.push(`font-family:${textStyle.weightedFontFamily.fontFamily}`);
            }


            if (styleAttributes.length > 0) {
              styledText = `<span style="${styleAttributes.join('; ')}">${styledText}</span>`;
            }


            blogContent += styledText;
          }
        }

        if (element.paragraph.bullet) {
          blogContent += `</li>`;
        } else {
          blogContent += `</p>`;
        }
      }
    }


    if (currentListType) {
      blogContent += currentListType === 'ordered' ? '</ol>' : '</ul>';
    }


    const params = new PutCommand({
    TableName: BLOGPOST_TABLE,
      Item: {
        postId,            
        createdAt,             
        title,
        author,
        content: blogContent,   
        images: imageUrls,
      },
    });

    await dynamoDB.send(params);

    res.status(201).json({ message: 'Blog post created successfully', postId });
  } catch (error) {
    console.error('Error creating blog post:', error);
    res.status(500).json({ error: 'Failed to create blog post' });
  }
};


const { DescribeTableCommand } = require("@aws-sdk/client-dynamodb");

const getBlogPost = async (req, res) => {
  console.log('Received request params:', req.params);
  const { docId } = req.params;
  console.log('Fetching blog post with docId:', docId);

  console.log('Table name:', BLOGPOST_TABLE);

  // Check if docId is valid
  if (!docId || typeof docId !== 'string' || docId.trim() === '') {
    console.error('Invalid or missing docId');
    return res.status(400).json({ error: 'Invalid or missing docId' });
  }

  try {
    // First, describe the table to get its key schema
    const describeParams = {
      TableName: BLOGPOST_TABLE
    };
    const describeCommand = new DescribeTableCommand(describeParams);
    const tableDescription = await dynamoDB.send(describeCommand);
    console.log('Table description:', JSON.stringify(tableDescription, null, 2));
    console.log('Table key schema:', JSON.stringify(tableDescription.Table.KeySchema, null, 2));
    console.log('Table attribute definitions:', JSON.stringify(tableDescription.Table.AttributeDefinitions, null, 2));

    // Log the type of docId
    console.log('Type of docId:', typeof docId);

    // Now proceed with fetching the blog post
    const params = {
      TableName: BLOGPOST_TABLE,
      FilterExpression: 'docId = :docId',
      ExpressionAttributeValues: {
        ':docId': docId
      }
    };
    console.log('Scan params:', JSON.stringify(params, null, 2));

    const command = new ScanCommand(params);
    const data = await dynamoDB.send(command);
    console.log('DynamoDB response:', JSON.stringify(data, null, 2));

    if (!data.Items || data.Items.length === 0) {
      console.log('Blog post not found');
      return res.status(404).json({ error: 'Blog post not found' });
    }

    // Assuming the first item is the one we want (there should only be one)
    res.status(200).json(data.Items[0]);
  } catch (error) {
    console.error('Error fetching blog post:', error);
    if (error.name === 'ValidationException') {
      console.error('Validation error details:', error.message);
      return res.status(400).json({ error: 'Validation error', details: error.message });
    }
    res.status(500).json({ error: 'Error fetching blog post', details: error.message });
  }
};


const getAllBlogPosts = async (req, res) => {
  const limit = 2; // Set the number of items per page
  // let pageNumber = parseInt(req.query.page, 10) || 1; // Default to the first page if not provided
  let pageNumber=req.query.page || 0
  // const lastEvaluatedKey = req.query.lastEvaluatedKey ? JSON.parse(req.query.lastEvaluatedKey) : null;
  
  const params = {
    TableName: BLOGPOST_TABLE,
    Limit: limit,
  };

  try {
    let lastKey = null;
    let currentPage = 1;
    let data;

    // Loop through pages until we reach the desired page
    let dat=[]
    for (let i = 0; i <= pageNumber; i ++){
      if (lastKey) {
        params.ExclusiveStartKey = lastKey; // Correctly assign lastKey to ExclusiveStartKey
      }
      data = await dynamoDB.send(new ScanCommand(params));
      dat.push(data)
      lastKey = data?.LastEvaluatedKey; 
      console.log(i, data)
      if(!lastKey) throw new Error('Invalid page range')

      
}
let current=dat[pageNumber]

    // // Fetch total count (optional, but this can be slow for large tables)
    const countParams = {
    TableName: BLOGPOST_TABLE,
      Select: 'COUNT',
    };
    const countData = await dynamoDB.send(new ScanCommand(countParams));
    const totalCount = countData.Count;
    // console.log(data.LastEvaluatedKey)

    res.status(200).json({
      data: current.Items,
      lastEvaluatedKey: current.LastEvaluatedKey || null,
      totalCount: totalCount,
      pageNumber: pageNumber,
    });
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};










//login part

const loginUser = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }

    try {
        console.log(`Attempting login for email: ${email}`);
        console.log(`User provided password: ${password}`);

        const params = new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        });

        const result = await dynamoDB.send(params);

        if (!result.Items || result.Items.length === 0) {
            console.log('User not found');
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const user = result.Items[0];

        if (!user.password) {
            console.log('User has no password set');
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        console.log(`Hashed password from DynamoDB: ${user.password}`);

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);

        console.log(`Password match result: ${isMatch}`);

        if (!isMatch) {
            console.log('Password does not match');
            return res.status(401).json({ message: 'Invalid email or password' });
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

        // Set JWT in cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 3600000,
        });

        console.log('Login successful');
        return res.status(200).json({ message: 'Login successful', token });

    } catch (error) {
        console.error('Error during login:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};











//reg - part 

require('dotenv').config();
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
// AWS SNS setup
const sns = new SNSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// DynamoDB Table Name
// const TABLE_NAME = 'users';

// Generate OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendSMSMessage(sns, params) {
    const command = new PublishCommand(params);
    const response = await sns.send(command);
    return response;
}

// Send SMS via AWS SNS
async function sendSMS(mobile, otp) {
    console.log('Entering sendSMS function');
    console.log('Mobile:', mobile);
    console.log('OTP:', otp);
    // console.log('AWS_REGION:', process.env.AWS_REGION);
    // console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID.substring(0, 5) + '...');
    // console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY.substring(0, 5) + '...');
    
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
                StringValue: 'SenderID', // Replace with your actual sender ID
            },
        },
    };
    console.log('SMS params:', JSON.stringify(params, null, 2));

    // Create an SNS client instance
    const sns = new SNSClient({
        region: process.env.AWS_REGION, // Use AWS_REGION instead of REGION
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });
    console.log('SNS client created');

    try {
        console.log('Attempting to send SMS');
        // Call the sendSMSMessage function with the correct parameters
        const response = await sendSMSMessage(sns, params);
        console.log('Message sent successfully:', JSON.stringify(response, null, 2));
        return true;
    } catch (error) {
        console.error('Error sending message:', error);
        if (error.name === 'InvalidParameterException') {
            throw new Error('Invalid phone number or message. Please check the phone number format.');
        } else if (error.name === 'AuthorizationErrorException') {
            throw new Error('AWS authorization failed. Please check your AWS credentials and permissions.');
        } else {
            throw new Error('Failed to send SMS. Please try again later.');
        }
    }
}



// Register user and send OTP
const register = async (req, res) => {
    try {
        console.log('Entering register function');
        const { firstName, lastName, email, phone } = req.body;
        console.log('Request body:', req.body);

        if (!firstName || !lastName || !email || !phone) {
            console.log('Missing required fields');
            return res.status(400).json({ message: 'All fields are required.' });
        }

        console.log(`Attempting to register user with email: ${email}`);

        // Check if user already exists in DynamoDB
        const checkParams = new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        });
        console.log('Check existing user params:', JSON.stringify(checkParams, null, 2));
        
        const existingUser = await dynamoDB.send(checkParams);
        console.log('Existing user check result:', JSON.stringify(existingUser, null, 2));

        if (existingUser.Items && existingUser.Items.length > 0) {
            console.log('User already exists');
            return res.status(409).json({ message: 'User already registered.' });
        }

        // Generate OTP and send SMS
        const otp = generateOtp();
        console.log(`Generated OTP for ${email}: ${otp}`);
        
        try {
            console.log(`Attempting to send SMS to phone: ${phone}`);
            await sendSMS(phone, otp);
            console.log('SMS sent successfully');
        } catch (smsError) {
            console.error('Error sending SMS:', smsError);
            return res.status(500).json({ message: 'Failed to send OTP. Please try again.', error: smsError.message });
        }

        // Generate userId
        const userId = (firstName.substring(0, 2) + lastName.substring(0, 2) + phone.slice(-4)).toUpperCase();
        console.log('Generated userId:', userId);

        // Save user temporarily with OTP in DynamoDB
        const userItem = new PutCommand({
            TableName: USERS_TABLE,
            Item: {
                userId: userId,
                firstName,
                lastName,
                email,
                phone,
                otp,
                createdAt: new Date().toISOString(),
            },
        });
        console.log('User item to be saved:', JSON.stringify(userItem, null, 2));

        try {
            await dynamoDB.send(userItem);
            console.log('User saved to DynamoDB');
        } catch (dbError) {
            console.error('Error saving user to DynamoDB:', dbError);
            return res.status(500).json({ message: 'Failed to register user. Please try again.' });
        }

        // Set userId in cookie
        res.cookie('userId', userId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 3600000,
        });
        

        console.log(`User registered successfully with ID: ${userId}`);
        res.status(200).json({ message: 'OTP sent to your mobile number.', userId });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Internal Server Error.' });
    }
};

// Verify OTP and set password
const verifyOtp = async (req, res) => {
    try {
        console.log('Entering verifyOtp function');
        console.log('Request body:', req.body);
        const { userId, otp, password, confirmPassword } = req.body;

        if (!userId) {
            console.log('User ID is required');
            return res.status(400).json({ message: 'User ID is required.' });
        }

        console.log(`Verifying OTP for userId: ${userId}`);

        if (!otp || !password || !confirmPassword) {
            console.log('Missing required fields:', { otp, password, confirmPassword });
            return res.status(400).json({ message: 'All fields are required.', missingFields: { otp: !otp, password: !password, confirmPassword: !confirmPassword } });
        }

        if (password !== confirmPassword) {
            console.log('Passwords do not match');
            return res.status(400).json({ message: 'Passwords do not match.' });
        }

        console.log('Preparing to scan DynamoDB');
        // Find the user with the provided userId from DynamoDB
        const scanParams = new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression: 'userId = :userId AND otp = :otp',
            ExpressionAttributeValues: {
                ':userId': userId,
                ':otp': otp
            }
        });
        console.log('Scan params:', JSON.stringify(scanParams, null, 2));
        
        let result;
        try {
            result = await dynamoDB.send(scanParams);
            console.log('DynamoDB scan result:', JSON.stringify(result, null, 2));
        } catch (dbError) {
            console.error('Error scanning DynamoDB:', dbError);
            throw new Error('Database error during OTP verification');
        }

        if (!result.Items || result.Items.length === 0) {
            console.log('Invalid OTP');
            return res.status(400).json({ message: 'Invalid OTP.' });
        }

        const user = result.Items[0];
        console.log('User found:', JSON.stringify(user, null, 2));

        // Hash the password
        let hashedPassword;
        try {
            hashedPassword = await bcrypt.hash(password, 10);
            console.log('Password hashed successfully');
        } catch (bcryptError) {
            console.error('Error hashing password:', bcryptError);
            throw new Error('Error processing password');
        }

        console.log('Preparing to update user in DynamoDB');
        // Update user with the password and remove OTP
        const updateParams = new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: user.userId },
            UpdateExpression: 'set password = :password, otp = :otp',
            ExpressionAttributeValues: {
                ':password': hashedPassword,
                ':otp': null,
            },
        });
        console.log('Update params:', JSON.stringify(updateParams, null, 2));

        try {
            await dynamoDB.send(updateParams);
            console.log('User updated with hashed password');
        } catch (updateError) {
            console.error('Error updating user in DynamoDB:', updateError);
            throw new Error('Database error during user update');
        }

        console.log('Sending success response');
        res.status(200).json({ message: 'Password set successfully.' });
    } catch (error) {
        console.error('Error during OTP verification:', error.message);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// Save company details (Signup step three)
const saveCompanyDetails = async (req, res) => {
    try {
        const { userId, organisation, industry, size, website } = req.body;
        console.log('Request body:', req.body);

        if (!userId) {
            return res.status(400).json({ message: 'User ID is required.' });
        }

        console.log('Company details:', { organisation, industry, size, website });

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
            console.log('User not found');
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
        console.log('Company details saved successfully');

        res.status(200).json({
            message: 'Company details saved successfully.',
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone
        });
    } catch (error) {
        console.error('Error during saving company details:', error);
        res.status(500).json({ message: 'Internal Server Error.' });
    }
};

// Get company details
const userDetails = async (req, res) => {
    try {
        console.log('Entering userDetails function');
        console.log('Request query:', req.query);
        console.log('Request params:', req.params);
        console.log('Request body:', req.body);

        let userId = req.query.userId || req.params.userId || (req.body && req.body.userId);

        if (!userId) {
            console.log('User ID is missing from request');
            return res.status(400).json({ message: 'User ID is required.' });
        }

        console.log(`Fetching user details for userId: ${userId}`);

        // Find the user by userId
        const getParams = new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: userId }
        });

        console.log('GetCommand params:', JSON.stringify(getParams, null, 2));

        const result = await dynamoDB.send(getParams);

        console.log('DynamoDB result:', JSON.stringify(result, null, 2));

        if (!result.Item) {
            console.log(`User not found for userId: ${userId}`);
            return res.status(404).json({ message: 'User not found.' });
        }

        const user = result.Item;

        console.log(`User found:`, JSON.stringify(user, null, 2));

        res.status(200).json({
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            organisation: user.organisation,
            industry: user.industry,
            size: user.size,
            website: user.website
        });
    } catch (error) {
        console.error('Error during fetching user details:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

module.exports = { 
    loginUser, 
    register, 
    verifyOtp, 
    saveCompanyDetails, 
    userDetails,
    createBlogPostFromGoogleDoc,
    getBlogPost,
    getAllBlogPosts
};
