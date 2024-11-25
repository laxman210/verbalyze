const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();


const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});


const uploadImageToS3 = async (imageBuffer, imageName) => {
  const params = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: imageName,
    Body: imageBuffer,
    ACL: 'public-read', 
  });

  const result = await s3.send(params);
  const imageUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageName}`;
  return imageUrl; 
};

module.exports = { uploadImageToS3 };
