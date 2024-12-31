try {
  const helmet = require('helmet');
  const express = require('express');
  const cors = require('cors');
  const app = express();
  require('dotenv').config();

  // Middleware for parsing JSON
  app.use(express.json());

  // Middleware for parsing URL-encoded data (for form submissions)
  app.use(express.urlencoded({ extended: true }));

  // CORS configuration
  app.use(cors({
    origin: 'http://localhost:3000', // Allow requests from React frontend
    credentials: true, // Allow credentials (cookies, authorization headers, etc.)
  }));

  // Content Security Policy
  app.use(helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "http://localhost:3000", "http://localhost:5000"], // Updated backend port
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // May need to adjust based on your React app's requirements
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:", "blob:"],
    }
  }));

  // Log all incoming requests with more details
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    next();
  });

  // Routes
  const blogRoutes = require('./routes/blogRoutes');
  app.use('/api', blogRoutes);

  // Test route for getBlogPost
  app.get('/test-get-blog-post/:docId', async (req, res) => {
    const { getBlogPost } = require('./controllers/blogController');
    try {
      await getBlogPost(req, res);
    } catch (error) {
      console.error('Error in getBlogPost:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ message: 'Something went wrong!', error: err.message });
  });

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

} catch (error) {
  console.error('Error in application setup:', error);
}
