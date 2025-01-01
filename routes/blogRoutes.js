const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');
const userReg = require('../controllers/userReg');
const userLogin = require('../controllers/userlogin');
const { registerLimiter } = require('../middleware/rateLimiter');
const { validateRegistrationInput } = require('../middleware/inputValidation');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const dynamoDB = require('../config/dynamoDB');

// Wrapper function for async route handlers
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Authentication routes
router.post('/login', asyncHandler(userLogin.loginUser));
router.post('/signup', registerLimiter, validateRegistrationInput, asyncHandler(userReg.register));
router.post('/signuptwo', asyncHandler(userReg.verifyOtp));
router.post('/signupthree', asyncHandler(userReg.saveCompanyDetails));

// Remove the userDetails route as it's no longer present in userReg.js

// Blog routes
router.post('/blog', asyncHandler(blogController.createBlogPostFromGoogleDoc));
router.get('/blog/:postId', asyncHandler(blogController.getBlogPost));
router.get('/blogs', asyncHandler(blogController.getAllBlogPosts));

// Test route
router.get('/test', (req, res) => {
  console.log('Test route accessed');
  res.status(200).json({ message: 'Test route is working' });
});

// New test route to check if a user exists
router.get('/test-user/:email', asyncHandler(async (req, res) => {
  const { email } = req.params;
  const params = {
    TableName: process.env.USERS_TABLE,
    IndexName: 'EmailIndex',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: {
      ':email': email
    }
  };

  const command = new QueryCommand(params);
  const result = await dynamoDB.send(command);

  if (result.Items && result.Items.length > 0) {
    res.json({ message: 'User found', user: result.Items[0] });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
}));

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Route error:', err);
  res.status(500).json({ message: 'Something went wrong in the route handler', error: err.message });
});

module.exports = router;
