const helmet = require('helmet');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const app = express();
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Middleware for parsing cookies
app.use(cookieParser());

// Middleware for parsing JSON
app.use(express.json());

// Middleware for parsing URL-encoded data (for form submissions)
app.use(express.urlencoded({ extended: true }));

// CORS configuration
app.use(cors({
  origin: isProduction ? process.env.FRONTEND_URL : 'http://localhost:3000',
  credentials: true,
}));

// Enhanced security with Helmet
app.use(helmet());

// Content Security Policy
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    connectSrc: ["'self'", isProduction ? process.env.FRONTEND_URL : "http://localhost:3000"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:"],
    fontSrc: ["'self'", "data:", "blob:"],
  }
}));

// Logging
if (isProduction) {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Routes
const blogRoutes = require('./routes/blogRoutes');
app.use('/api', blogRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: isProduction ? 'Something went wrong!' : err.message,
    stack: isProduction ? '🥞' : err.stack
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});
