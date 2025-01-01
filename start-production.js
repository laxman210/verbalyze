// Set NODE_ENV to 'production'
process.env.NODE_ENV = 'production';

// Load environment variables
require('dotenv').config();

// Run the main application
require('./app.js');

console.log('Starting application in production mode...');
