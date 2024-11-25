const dynamoDB = require('../config/dynamoDB');
const { uploadImageToS3 } = require('../config/s3');
const docs = require('../config/googleAuth');
const { PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');


exports.createBlogPostFromGoogleDoc = async (req, res) => {
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
      TableName: process.env.DYNAMODB_TABLE,
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


exports.getBlogPost = async (req, res) => {
  const { postId } = req.params;

  const params = new GetCommand({
    TableName: process.env.DYNAMODB_TABLE,
    Key: { postId, createdAt: req.query.createdAt },
  });

  try {
    const data = await dynamoDB.send(params);
    if (!data.Item) {
      return res.status(404).json({ error: 'Blog post not found' });
    }
    res.status(200).json(data.Item);
  } catch (error) {
    console.error('Error fetching blog post:', error);
    res.status(500).json({ error: 'Error fetching blog post' });
  }
};


exports.getAllBlogPosts = async (req, res) => {
  const params = new ScanCommand({
    TableName: process.env.DYNAMODB_TABLE,
  });

  try {

    const data = await dynamoDB.send(params);

    if (!data.Items || data.Items.length === 0) {
      return res.status(404).json({ message: 'No blog posts found' });
    }


    res.status(200).json(data.Items);
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
};
