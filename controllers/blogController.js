// Import required modules
const dynamoDB = require('../config/dynamoDB'); // For interacting with DynamoDB
const { uploadImageToS3 } = require('../config/s3'); // For uploading images to S3
const docs = require('../config/googleAuth'); // For Google Docs API access
const { PutCommand, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb'); // For DynamoDB commands
const { DescribeTableCommand } = require('@aws-sdk/client-dynamodb'); // For describing the table
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const fetch = require('node-fetch').default; // For fetching images from URLs
require('dotenv').config(); // Load environment variables

// Environment variables
const BLOGPOST_TABLE = process.env.BLOGPOST_TABLE;

console.log('Environment variables in blogController:');
console.log('BLOGPOST_TABLE:', BLOGPOST_TABLE);
console.log('All env variables:', process.env);

if (!BLOGPOST_TABLE) {
    console.error('Missing required environment variable: BLOGPOST_TABLE');
    process.exit(1);
}

// Reload environment variables (in case of caching issues)
delete require.cache[require.resolve('dotenv')];
require('dotenv').config();

// Check again after reloading
const RELOADED_BLOGPOST_TABLE = process.env.BLOGPOST_TABLE;
console.log('Reloaded BLOGPOST_TABLE:', RELOADED_BLOGPOST_TABLE);

if (!RELOADED_BLOGPOST_TABLE) {
    console.error('Missing required environment variable after reload: BLOGPOST_TABLE');
    process.exit(1);
}

// Blog-related functions
const createBlogPostFromGoogleDoc = async (req, res) => {
  console.log('Received request to create blog post');
  const { title, author, docId } = req.body;
  console.log(`Request body: title=${title}, author=${author}, docId=${docId}`);

  try {
    const postId = uuidv4(); 
    console.log(`Generated postId: ${postId}`);
    const createdAt = new Date().toISOString(); 
    let blogContent = ''; 
    const imageUrls = []; 
    let currentListType = null; 
    let currentNestingLevel = -1; 

    console.log(`Fetching Google Doc content for docId: ${docId}`);
    let doc;
    try {
      doc = await docs.documents.get({ documentId: docId });
      console.log('Successfully fetched Google Doc');
    } catch (error) {
      console.error('Error fetching Google Doc:', error);
      throw error;
    }

    console.log('Processing positioned objects');
    const positionedObjects = doc.data.positionedObjects;
    if (positionedObjects) {
      console.log(`Found ${Object.keys(positionedObjects).length} positioned objects`);
      for (const [objectId, positionedObject] of Object.entries(positionedObjects)) {
        console.log(`Processing object ${objectId}`);
        const embeddedObject = positionedObject.positionedObjectProperties.embeddedObject;
        if (embeddedObject && embeddedObject.imageProperties && embeddedObject.imageProperties.contentUri) {
          const imageUrl = embeddedObject.imageProperties.contentUri;
          console.log(`Found image with objectId: ${objectId}, URL: ${imageUrl}`);

          try {
            const imageBuffer = await fetch(imageUrl).then(res => {
              if (res.ok) {
                return res.buffer();
              }
              throw new Error(`Failed to fetch image: ${imageUrl}`);
            });

            console.log(`Successfully fetched image: ${imageUrl}`);
            const imageKey = `blog_images/${postId}_${uuidv4()}.png`;
            const s3ImageUrl = await uploadImageToS3(imageBuffer, imageKey);
            console.log(`Successfully uploaded image to S3: ${s3ImageUrl}`);
            imageUrls.push(s3ImageUrl);

            blogContent += `<img src="${s3ImageUrl}" alt="Blog Image"/>`;
          } catch (error) {
            console.error(`Error processing image ${objectId}:`, error);
          }
        }
      }
    } else {
      console.log('No positioned objects found');
    }

    console.log('Processing inline objects');
    const inlineObjects = doc.data.inlineObjects;
    if (inlineObjects) {
      console.log(`Found ${Object.keys(inlineObjects).length} inline objects`);
      for (const [objectId, inlineObject] of Object.entries(inlineObjects)) {
        const embeddedObject = inlineObject.inlineObjectProperties.embeddedObject;
        if (embeddedObject && embeddedObject.imageProperties && embeddedObject.imageProperties.sourceUri) {
          const imageUrl = embeddedObject.imageProperties.sourceUri;
          console.log(`Found inline image with objectId: ${objectId}, URL: ${imageUrl}`);

          try {
            const imageBuffer = await fetch(imageUrl).then(res => {
              if (res.ok) {
                return res.buffer();
              }
              throw new Error(`Failed to fetch inline image: ${imageUrl}`);
            });

            console.log(`Successfully fetched inline image: ${imageUrl}`);
            const imageKey = `blog_images/${postId}_${uuidv4()}.png`;
            const s3ImageUrl = await uploadImageToS3(imageBuffer, imageKey);
            console.log(`Successfully uploaded inline image to S3: ${s3ImageUrl}`);
            imageUrls.push(s3ImageUrl);

            blogContent += `<img src="${s3ImageUrl}" alt="Blog Image"/>`;
          } catch (error) {
            console.error(`Error processing inline image ${objectId}:`, error);
          }
        }
      }
    } else {
      console.log('No inline objects found');
    }

    console.log('Processing content');
    const content = doc.data.body.content;
    const lists = doc.data.lists || {};

    console.log(`Number of content elements: ${content.length}`);

    for (const element of content) {
      if (element.paragraph) {
        console.log('Processing paragraph');
        const paragraphStyle = element.paragraph.paragraphStyle || {};

        const indentStart = paragraphStyle.indentStart ? `${paragraphStyle.indentStart.magnitude}px` : '0px';
        const indentFirstLine = paragraphStyle.indentFirstLine ? `${paragraphStyle.indentFirstLine.magnitude}px` : '0px';
        const paragraphIndent = indentFirstLine !== '0px' ? indentFirstLine : indentStart;

        if (element.paragraph.bullet) {
          console.log('Processing bullet point');
          const listId = element.paragraph.bullet.listId;
          const list = lists[listId];
          const nestingLevel = element.paragraph.bullet.nestingLevel || 0;

          if (currentListType !== 'unordered' || currentNestingLevel !== nestingLevel) {
            if (currentListType) {
              blogContent += currentListType === 'ordered' ? '</ol>' : '</ul>';
            }
            blogContent += '<ul>';
            currentListType = 'unordered';
            currentNestingLevel = nestingLevel;
          }

          blogContent += '<li>';
        } else {
          console.log('Processing regular paragraph');
          if (currentListType) {
            blogContent += currentListType === 'ordered' ? '</ol>' : '</ul>';
            currentListType = null;
            currentNestingLevel = -1;
          }
          blogContent += `<p style="text-indent: ${paragraphIndent};">`;
        }

        console.log('Processing paragraph elements');
        for (const el of element.paragraph.elements) {
          if (el.textRun && el.textRun.content.trim()) {
            console.log(`Processing text: ${el.textRun.content.trim()}`);
            let text = el.textRun.content;
            const textStyle = el.textRun.textStyle || {};

            if (textStyle.bold) text = `<strong>${text}</strong>`;
            if (textStyle.italic) text = `<em>${text}</em>`;
            if (textStyle.underline) text = `<u>${text}</u>`;

            blogContent += text;
          }
        }

        if (element.paragraph.bullet) {
          blogContent += '</li>';
        } else {
          blogContent += '</p>';
        }
      }
    }

    if (currentListType) {
      blogContent += currentListType === 'ordered' ? '</ol>' : '</ul>';
    }

    console.log('Finished processing content');
    console.log('Content to be saved:', blogContent);
    console.log('Content length:', blogContent.length);
    console.log('Saving blog post to DynamoDB');

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

    console.log('Blog post saved successfully');
    console.log('Saved item:', JSON.stringify(params.Item, null, 2));
    const response = { message: 'Blog post created successfully', postId };
    console.log('Sending response:', JSON.stringify(response));
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating blog post:', error);
    const errorResponse = { error: 'Failed to create blog post' };
    console.log('Sending error response:', JSON.stringify(errorResponse));
    res.status(500).json(errorResponse);
  }
};


const getBlogPost = async (req, res) => {
  console.log('Received request:', {
    params: req.params,
    query: req.query,
    body: req.body
  });
  
  let postId = req.params.postId;
  
  console.log('Initial postId from params:', postId);

  if (postId === 'undefined' || postId === undefined) {
    console.log('PostId is undefined in params, checking query');
    postId = req.query.postId;
    console.log('PostId from query:', postId);
  }
  
  if (postId === 'undefined' || postId === undefined) {
    console.log('PostId is undefined in query, checking body');
    postId = req.body.postId;
    console.log('PostId from body:', postId);
  }

  console.log('Final postId value:', postId);
  console.log('Table name:', BLOGPOST_TABLE);

  // Check if postId is valid
  if (!postId || postId === 'undefined' || typeof postId !== 'string' || postId.trim() === '') {
    console.error('Invalid or missing postId');
    return res.status(400).json({ 
      error: 'Invalid or missing postId', 
      receivedValue: postId,
      params: req.params,
      query: req.query,
      body: req.body
    });
  }

  try {
    // Now proceed with fetching the blog post using a scan operation
    const params = {
      TableName: BLOGPOST_TABLE,
      FilterExpression: 'postId = :id',
      ExpressionAttributeValues: {
        ':id': postId
      }
    };
    console.log('Scan params:', JSON.stringify(params, null, 2));

    const command = new ScanCommand(params);
    const data = await dynamoDB.send(command);
    console.log('DynamoDB response:', JSON.stringify(data, null, 2));

    if (!data.Items || data.Items.length === 0) {
      console.log('Blog post not found');
      return res.status(404).json({ error: 'Blog post not found', postId: postId });
    }

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
  console.log('getAllBlogPosts function called');
  console.log('BLOGPOST_TABLE:', BLOGPOST_TABLE);
  
  const limit = 5 // Set the number of items per page
  let pageNumber = req.query.page || 0;
  
  const params = {
    TableName: BLOGPOST_TABLE,
    Limit: limit,
  };

  console.log('Scan params:', JSON.stringify(params, null, 2));

  try {
    let lastKey = null;
    let currentPage = 1;
    let data;

    // Loop through pages until we reach the desired page
    let dat = [];
    for (let i = 0; i <= pageNumber; i++) {
      if (lastKey) {
        params.ExclusiveStartKey = lastKey; // Correctly assign lastKey to ExclusiveStartKey
      }
      console.log(`Sending ScanCommand for page ${i}`);
      data = await dynamoDB.send(new ScanCommand(params));
      dat.push(data);
      lastKey = data?.LastEvaluatedKey; 
      console.log(`Page ${i} data:`, JSON.stringify(data, null, 2));
      if (!lastKey) {
        console.log(`No more pages after ${i}`);
        break;
      }
    }
    let current = dat[pageNumber];

    // Fetch total count (optional, but this can be slow for large tables)
    const countParams = {
      TableName: BLOGPOST_TABLE,
      Select: 'COUNT',
    };
    console.log('Count params:', JSON.stringify(countParams, null, 2));
    const countData = await dynamoDB.send(new ScanCommand(countParams));
    const totalCount = countData.Count;
    console.log('Total count:', totalCount);

    const response = {
      data: current.Items,
      lastEvaluatedKey: current.LastEvaluatedKey || null,
      totalCount: totalCount,
      pageNumber: pageNumber,
    };
    console.log('Response:', JSON.stringify(response, null, 2));
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};


module.exports = {
  // Blog functions
  createBlogPostFromGoogleDoc,
  getBlogPost,
  getAllBlogPosts,
};
