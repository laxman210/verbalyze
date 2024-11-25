const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');


router.post('/blog', blogController.createBlogPostFromGoogleDoc);


router.get('/blog/:postId', blogController.getBlogPost);


router.get('/blogs', blogController.getAllBlogPosts);

module.exports = router;
