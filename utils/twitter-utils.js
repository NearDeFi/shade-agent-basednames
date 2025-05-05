import { TwitterApi } from 'twitter-api-v2';

let client;

export async function getClient() {
    if (!client) {
        const consumerClient = new TwitterApi({
            appKey: process.env.TWITTER_API_KEY,
            appSecret: process.env.TWITTER_API_SECRET,
        });
        // client is global to this module, app-only client, used for search
        client = await consumerClient.appLogin();
    }
    return client;
}

// generate a url for a username + tweet.id

export const tweetUrl = (username, id) =>
    `https://x.com/${username}/status/${id}`;

// take a tweet timestamp and add 1 second so you can use this as your new start time and don't re-read tweets

export function addOneSecond(ts) {
    return ts
        ? new Date(
              new Date(ts).getTime() + 1000, // add 1 second
          )
              .toISOString()
              .split('.')[0] + 'Z'
        : undefined;
}

// polling for a search result (not a cron job, e.g. looking for a reply from @bankrbot for addresses)

export async function pollSearch(fn, attempts = 0, limit = 10, dur = 10000) {
    fn();
    attempts++;
    if (attempts >= limit) {
        console.log('pollSearch ended. Reached attempt limit:', limit);
    }
    await sleepThen(dur, () => pollSearch(fn, attempts, limit, dur));
}

// dealing with access tokens (user auth for agent)

let accessToken = process.env.TWITTER_ACCESS_TOKEN;
let refreshToken = process.env.TWITTER_REFRESH_TOKEN;

async function refreshAccessToken() {
    console.log('refreshAccessToken');
    const client = new TwitterApi({
        clientId: process.env.TWITTER_CLIENT_KEY,
        clientSecret: process.env.TWITTER_CLIENT_SECRET,
    });
    try {
        const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
            await client.refreshOAuth2Token(refreshToken);
        accessToken = newAccessToken;
        refreshToken = newRefreshToken;
        console.log('newAccessToken', newAccessToken);
        console.log('NEW REFRESH TOKEN', newRefreshToken);
        console.log('NEW REFRESH TOKEN', newRefreshToken);
        console.log('NEW REFRESH TOKEN', newRefreshToken);
    } catch (e) {
        console.log('error refreshAccessToken');
        console.log(e);
    }
}

// reply to a tweet with the text and tweet id to reply to

export async function replyToTweet(text, id, secondAttempt = false) {
    const client = new TwitterApi(accessToken);
    let res;
    try {
        res = await client.v2.reply(text, id);
    } catch (e) {
        console.log('error', e);
        if (!secondAttempt && /401/gi.test(JSON.stringify(e))) {
            await refreshAccessToken();
            res = await replyToTweet(text, id, true);
        }
    }
    // console.log(res);
    return res;
}

// getting the conversation id, in order to get the last tweet of a thread

export async function getConversationId(client, tweetId) {
    try {
        const tweet = await client.v2.singleTweet(tweetId, {
            'tweet.fields': 'conversation_id',
        });
        return tweet.data.conversation_id;
    } catch (e) {
        console.log('ERROR getConversationId', e);
    }
    return null;
}

export async function getLatestConversationTweet(
    client,
    conversationId,
    start_time,
) {
    try {
        const searchResult = await client.v2.search(
            `conversation_id:${conversationId}`,
            {
                start_time,
                'tweet.fields':
                    'author_id,created_at,referenced_tweets,conversation_id',
                max_results: 100, // might not work if thread is over 100 tweets long
            },
        );
        if (searchResult?.data?.meta?.result_count === 0) {
            return null;
        }

        return searchResult.data.data[0]; // Most recent tweet is first
    } catch (e) {
        console.log('ERROR getLatestConversationTweet', e);
    }
    return null;
}

export async function getReplyToTweet(client, tweetId) {
    try {
        const searchResult = await client.v2.search(
            `in_reply_to_tweet_id:${tweetId}`,
            {
                'tweet.fields':
                    'author_id,created_at,referenced_tweets,conversation_id',
                max_results: 100,
            },
        );
        if (searchResult?.data?.meta?.result_count === 0) {
            return null;
        }
        return searchResult.data.data[0];
    } catch (e) {
        console.log('ERROR getLatestConversationTweet', e);
    }
    return null;
}

export async function getReplyToTweetFromAuthor(client, tweetId, authorId) {
    try {
        const searchResult = await client.v2.search(
            `in_reply_to_tweet_id:${tweetId} from:${authorId}`,
            {
                'tweet.fields':
                    'author_id,created_at,referenced_tweets,conversation_id',
                max_results: 100,
            },
        );
        if (searchResult?.data?.meta?.result_count === 0) {
            return null;
        }
        return searchResult.data.data[0];
    } catch (e) {
        console.log('ERROR getLatestConversationTweet', e);
    }
    return null;
}
