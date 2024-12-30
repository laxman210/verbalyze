const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');

console.log('blogController contents:', Object.keys(blogController));

// Authentication routes
router.post('/login', blogController.loginUser);
router.post('/signup', blogController.register);
router.post('/signuptwo', blogController.verifyOtp);
router.post('/signupthree', blogController.saveCompanyDetails);
router.get('/signupfour', blogController.userDetails);

// Blog routes (commented out for now)
router.post('/blog', blogController.createBlogPostFromGoogleDoc);
router.get('/blog/:docId', blogController.getBlogPost);
router.get('/blogs', blogController.getAllBlogPosts);

module.exports = router;
