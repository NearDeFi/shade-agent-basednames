require('dotenv').config({ path: '.env.development.local' });
const express = require('express');
const session = require('express-session');
const { TwitterApi } = require('twitter-api-v2');

const PORT = 3001;
const CALLBACK = `https://224a-207-219-80-78.ngrok-free.app/api/callback`;
const app = express();

let cv, s;

const codeVerifier = app.use(
    session({
        secret: 'your secret key',
        resave: false,
        saveUninitialized: false,
    }),
);

// Step 1: Redirect user to Twitter's OAuth page
app.get('/auth/twitter', (req, res) => {
    const client = new TwitterApi({
        clientId: process.env.TWITTER_CLIENT_KEY,
        clientSecret: process.env.TWITTER_CLIENT_SECRET,
    });

    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
        CALLBACK,
        {
            scope: [
                'tweet.write',
                'tweet.read',
                'users.read',
                'offline.access',
            ],
        },
    );

    // Store codeVerifier and state in session
    cv = req.session.codeVerifier = codeVerifier;
    s = req.session.state = state;

    // Save the session before redirecting
    req.session.save((err) => {
        if (err) {
            console.error('Session save error:', err);
            return res.status(500).send('Error');
        }

        res.redirect(url);
    });
});

// Step 2: Handle callback
app.get('/api/callback', async (req, res) => {
    const { code, state } = req.query;
    // Check if state matches
    // if (state !== req.session.state) {
    //     return res.status(400).send('Invalid state');
    // }

    const client = new TwitterApi({
        clientId: process.env.TWITTER_CLIENT_KEY,
        clientSecret: process.env.TWITTER_CLIENT_SECRET,
    });

    try {
        // Exchange code for access token
        const loginRes = await client.loginWithOAuth2({
            code,
            codeVerifier: cv,
            redirectUri: CALLBACK,
        });

        console.log('loginRes', loginRes);

        const { accessToken, refreshToken } = loginRes;

        // Use the accessToken to make API calls
        const userClient = new TwitterApi(accessToken);
        const { data: user } = await userClient.v2.me();

        // Save tokens in session or database
        req.session.accessToken = accessToken;
        req.session.refreshToken = refreshToken;

        res.send(`Hello ${user.name}!`);
    } catch (error) {
        console.error('Error during OAuth callback:', error);
        res.status(500).send('Error logging in');
    }
});

app.listen(PORT, () => {
    console.log(`Example app listening on port ${PORT}`);
});
