const { google } = require('googleapis');
require('dotenv').config();

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/documents.readonly'];

oAuth2Client.setCredentials({ 
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  scope: SCOPES.join(' ')
});

const docs = google.docs({ version: 'v1', auth: oAuth2Client });

module.exports = docs;
