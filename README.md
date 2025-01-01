# Blog Backend

This is the backend for the Blog application.

## Production Deployment Instructions

1. **Install Dependencies**
   ```
   npm install
   ```

2. **Set Environment Variables**
   Ensure the following environment variables are set in your production environment:
   - NODE_ENV (set to 'production' in start-production.js)
   - PORT (if different from the default 5000)
   - AWS_REGION
   - AWS_ACCESS_KEY_ID
   - AWS_SECRET_ACCESS_KEY
   - USERS_TABLE
   - BLOGPOST_TABLE
   - TEMP_USERS_TABLE
   - JWT_SECRET
   - ACCESS_TOKEN_EXPIRY
   - REFRESH_TOKEN_EXPIRY
   - REMEMBER_ME_EXPIRY
   - GOOGLE_CLIENT_ID
   - GOOGLE_CLIENT_SECRET
   - GOOGLE_REDIRECT_URI
   - GOOGLE_REFRESH_TOKEN
   - FRONTEND_URL (the URL of your frontend application in production)

3. **Start the Application**
   ```
   node start-production.js
   ```

## Security Considerations

- Ensure all sensitive information is securely stored and not exposed in the codebase or version control.
- Use HTTPS in production to encrypt data in transit.
- Regularly update dependencies to patch any security vulnerabilities.

## Logging and Monitoring

- The application uses Morgan for HTTP request logging.
- Implement application-level logging for important events and errors.
- Set up monitoring and alerting for your production environment.

## Performance Optimization

- Implement caching mechanisms for frequently accessed data.
- Optimize database queries and indexes for better performance.
- Use a process manager like PM2 to keep the application running and handle crashes or restarts.

## Scalability

- Consider using a load balancer if you need to scale horizontally.
- Implement database connection pooling for better efficiency.

Remember to regularly backup your data and have a disaster recovery plan in place.
