const express = require("express");
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const { error } = require("console");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const credentials = {
  web: {
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    redirect_uris: [process.env.REDIRECT_URI],
  },
};

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_PATH = path.join(__dirname, "token.json");

// Route to start OAuth flow
app.get("/authorize", (req, res) => {
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  res.redirect(authUrl);
});

// Route to handle OAuth callback
app.get("/oauth2callback", (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("No code provided");
  }

  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  oAuth2Client.getToken(code, (err, token) => {
    if (err)
      return res.status(500).send("Error retrieving access token: " + err);
    oAuth2Client.setCredentials(token);
    fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
      if (err) return res.status(500).send("Error saving token: " + err);
      res.send("Authorization successful! You can now fetch emails.");
    });
  });
});

// Example route to fetch emails
app.post("/emails", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Vui lòng nhập mail." });

  authorize((auth) => listEmails(auth, res, email));
});

function authorize(callback) {
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return res.redirect("/authorize");
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

function listEmails(auth, res, email) {
  const gmail = google.gmail({ version: "v1", auth });
  gmail.users.messages.list(
    {
      userId: "me",
      maxResults: 1,
      labelIds: ["INBOX"],
      q: `to:${email}`,
    },
    (err, result) => {
      if (err) return res.status(500).send("The API returned an error: " + err);
      const messages = result.data.messages;
      if (messages && messages.length) {
        const message = messages[0];
        gmail.users.messages.get(
          { userId: "me", id: message.id },
          (err, emailData) => {
            if (err)
              return res.status(500).send("Error fetching message: " + err);
            let body = "";
            if (emailData.data.payload.parts) {
              const part = emailData.data.payload.parts.find(
                (part) => part.mimeType === "text/plain"
              );
              body = part
                ? Buffer.from(part.body.data, "base64").toString()
                : "";
            } else {
              body = emailData.data.payload.body.data
                ? Buffer.from(
                    emailData.data.payload.body.data,
                    "base64"
                  ).toString()
                : "";
            }
            const specificUrl = extractLink(body);
            const emailInfo = specificUrl
              ? { link: specificUrl }
              : {
                  error:
                    "Mail chưa về, bạn làm lại theo thứ tự - Bấm Send mail trước nha.",
                };

            res.json(emailInfo);
          }
        );
      } else {
        res
          .status(404)
          .json({ error: "Mail ko đúng hoặc ko thuộc dịch vụ bên mình." });
      }
    }
  );
}

function extractLink(body) {
  const plainTextBody = body.replace(/<\/?[^>]+(>|$)/g, "");
  const urlRegex = /https?:\/\/[^\s\]]+/g;
  const urls = plainTextBody.match(urlRegex);
  const specificUrl = urls?.find(
    (url) =>
      url.includes("travel/verify?nftoken") ||
      url.includes("update-primary-location")
  );
  return specificUrl || null;
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
