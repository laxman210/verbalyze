console.log('Starting application...');
try {
  const helmet = require('helmet');
  const express = require('express');
  const cors = require('cors');
  const app = express();
  require('dotenv').config();
  console.log('Modules loaded successfully');

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

  // Routes
  const blogRoutes = require('./routes/blogRoutes');
app.use('/api', blogRoutes);

// Test route for getBlogPost
app.get('/test-get-blog-post/:docId', async (req, res) => {
  console.log('Test route hit with docId:', req.params.docId);
  const { getBlogPost } = require('./controllers/blogController');
  try {
    await getBlogPost(req, res);
  } catch (error) {
    console.error('Error in getBlogPost:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`Received ${req.method} request for ${req.url}`);
  next();
});

// Error handling middleware
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
  });

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Make a test request to our endpoint
    const http = require('http');
    const testPostId = '1Bob9NdERcnVQsIgL7RhZWrFYCsOH0otzIFAgM7_OdNw';
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: `/test-get-blog-post/${testPostId}`,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      console.log(`Test request status: ${res.statusCode}`);
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log('Test request response:', data);
      });
    });

    req.on('error', (error) => {
      console.error('Error making test request:', error);
    });

    req.end();
  });

} catch (error) {
  console.error('Error in application setup:', error);
}
