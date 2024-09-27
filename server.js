const express = require("express");
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const bodyParser = require("body-parser");
require("dotenv").config(); // Load environment variables from .env

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON body
app.use(bodyParser.json());

const credentials = {
  web: {
    client_id: process.env.CLIENT_ID,
    project_id: process.env.PROJECT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_CERT_URL,
    client_secret: process.env.CLIENT_SECRET,
    redirect_uris: [process.env.REDIRECT_URI, process.env.DEPLOY_REDIRECT_URI],
    javascript_origins: [process.env.ORIGIN_1, process.env.ORIGIN_2],
  },
};

// Scopes to authorize access to Gmail API
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_PATH = path.join(__dirname, "token.json");

// Route to start OAuth process
app.get("/authorize", (req, res) => {
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0] // Make sure the redirect URI matches the one in Google Console
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  res.redirect(authUrl); // Redirect user to the consent page
});

// Callback route to handle OAuth2 callback and store the token
app.get("/oauth2callback", (req, res) => {
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Authorization code not found.");
  }

  // Exchange the authorization code for a token
  oAuth2Client.getToken(code, (err, token) => {
    if (err) return res.status(500).send("Error retrieving access token");

    // Store the token to disk for later program executions
    fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
      if (err) return res.status(500).send("Error saving token.");
      res.send("Authorization successful! You can now use the Gmail API.");
    });
  });
});

// Route to handle POST request to filter emails by receiver's email
app.post("/emails", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).send("Receiver's email is required.");
  }

  authorize(credentials, (auth) => listEmails(auth, res, email));
});

/**
 * Create an OAuth2 client with the given credentials, and then call the Gmail API.
 */
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      return callback(oAuth2Client); // If no token, we need to authorize
    }
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Lists the latest email filtered by receiver's email.
 * Filters emails to the specified email address and returns only the latest one.
 */
function listEmails(auth, res, email) {
  const gmail = google.gmail({ version: "v1", auth });

  // Use the `q` parameter to filter by the recipient's email address
  gmail.users.messages.list(
    {
      userId: "me",
      maxResults: 1, // Get only the latest 1 email
      labelIds: ["INBOX"],
      q: `to:${email}`, // Filter by receiver's email
    },
    (err, result) => {
      if (err) return res.status(500).send("The API returned an error: " + err);
      const messages = result.data.messages;
      if (messages && messages.length) {
        const message = messages[0]; // Get only the latest email

        gmail.users.messages.get(
          { userId: "me", id: message.id },
          (err, emailData) => {
            if (err)
              return res.status(500).send("Error fetching message: " + err);

            // Extract the email body
            let body = "";
            if (emailData.data.payload.parts) {
              // Check if the message contains parts (multipart email)
              const part = emailData.data.payload.parts.find(
                (part) => part.mimeType === "text/plain"
              );
              body = part
                ? Buffer.from(part.body.data, "base64").toString()
                : "";
            } else {
              // If it's a single part email
              body = emailData.data.payload.body.data
                ? Buffer.from(
                    emailData.data.payload.body.data,
                    "base64"
                  ).toString()
                : "";
            }

            // Extract the specific URL from the body
            const specificUrl = extractLink(body);

            const emailInfo = {
              link: specificUrl || "Mail chưa về",
            };

            res.json(emailInfo); // Send the latest email's subject, body, and specific URL as a JSON response
          }
        );
      } else {
        res.status(404).send(`No messages found to ${email}.`);
      }
    }
  );
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
