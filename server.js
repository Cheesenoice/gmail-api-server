const express = require("express");
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON body
app.use(bodyParser.json());

// Path to your credentials.json
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");

// Load client secrets and scopes from a local file
function loadCredentials() {
  const content = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
  return JSON.parse(content);
}

// Route to handle POST request to filter emails by receiver's email
app.post("/emails", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).send("Receiver's email is required.");
  }

  const credentials = loadCredentials();
  const SCOPES = credentials.scopes;

  authorize(credentials, SCOPES, (auth) => listEmails(auth, res, email));
});

/**
 * Create an OAuth2 client with the given credentials, and then call the Gmail API.
 */
function authorize(credentials, SCOPES, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, SCOPES, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the callback with the authorized OAuth2 client.
 */
function getNewToken(oAuth2Client, SCOPES, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this URL:", authUrl);
  const rl = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log("Token stored to", TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
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

const extractLink = (body) => {
  const plainTextBody = body.replace(/<\/?[^>]+(>|$)/g, "");

  if (plainTextBody.includes("travel/verify?nftoken")) {
    const urlRegex = /https?:\/\/[^\s\]]+/g;
    const urls = plainTextBody.match(urlRegex);
    const specificUrl = urls?.find((url) =>
      url.includes("travel/verify?nftoken")
    );
    if (specificUrl) {
      return specificUrl;
    }
  }

  if (plainTextBody.includes("update-primary-location")) {
    const urlRegex = /https?:\/\/[^\s\]]+/g;
    const urls = plainTextBody.match(urlRegex);
    const specificUrl = urls?.find((url) =>
      url.includes("update-primary-location")
    );
    if (specificUrl) {
      return specificUrl;
    }
  }

  return null;
};

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
