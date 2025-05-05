import { networkId, generateAddress } from '@neardefi/shade-agent-js';
import { evm } from '../../utils/evm';
import { fetchJson, sleepThen } from '../../utils/utils';
import {
    getClient,
    addOneSecond,
    replyToTweet,
    getLatestConversationTweet,
    getReplyToTweetFromAuthor,
    tweetUrl,
} from '../../utils/twitter-utils';
import { getMetadata, pinataUpload } from '../../utils/pinata';

// !!! CONFIG CHECK BEFORE DEPLOY TO PHALA !!!
const BOT_USERNAME = '@proximityagent';
const SEARCH_TERM = '"coin"';
const BANKR_BOT_ID = '1864452692221022210';
// limit X usernames allowed to coin it
const ALLOWED_USERNAMES = [
    'mattdlockyer',
    'miaojiang',
    'kendaIIc',
    'EdsonAlcala',
    'ThePiVortex',
];
// can test independently
const TEST_GETLOGS = false;
// check deployZora method for how these work
const TEST_METADATA = false;
const TEST_PINATA = false;
const TEST_DEPLOY = false;
// if you have a tweet to bankrbot that needs testing for reply and address extraction
const TEST_BANKR_REPLY = false;
// MAKE TRUE IF DOING ISOLATED TESTING
const NO_SEARCH = false;
const NO_REPLY = false;
// LEAVE THIS ON IN PRODUCTION
const USE_START_TIME = true;
let lastTweetTimestamp =
    process.env.TWITTER_LAST_TIMESTAMP || '2025-05-04T14:21:27.655Z';

// queues
const PENDING_BANKR_ADDRESSES_DELAY = 2000;
const pendingBankrReply = [];

// main endpoint for cron job is at the bottom and the flow works it's way up

const getCoinAddressFromLogs = async (
    hash = '0x27d65e59cc4ffd186532e2fd6863a2b4cf49d9befc6f59315d74271f42b7688b',
    block,
) => {
    const address = '0x777777751622c0d3258f214F9DF38E35BF45baF3'; // zora contract
    const topic =
        '0x3d1462491f7fa8396808c230d95c3fa60fd09ef59506d0b9bd1cf072d2a03f56';

    if (!block && !!hash) {
        const receipt = await evm.getTransactionReceipt(hash);
        block = receipt.blockNumber;
    }
    const fromBlock = block;
    const toBlock = block;

    try {
        const res = await fetchJson(
            `https://api${
                networkId === 'testnet' ? '-sepolia' : ''
            }.basescan.org/api?module=logs&action=getLogs&address=${address}&fromBlock=${fromBlock}&toBlock=${toBlock}&topic0=${topic}&apikey=${
                process.env.BASE_API_KEY
            }`,
        );

        const beforeAddressHex =
            '0x000000000000000000000000420000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000180000000000000000000000000';

        const log = res.result.filter((r) => r.transactionHash === hash)[0];
        const coinAddress = log.data.substring(
            beforeAddressHex.length,
            beforeAddressHex.length + 40,
        );
        console.log('coinAddress', coinAddress);
        return coinAddress;
    } catch (e) {
        console.log(e);
    }
};

if (TEST_GETLOGS) {
    getCoinAddressFromLogs(
        '0xb1e20a00662c52d3e750d5e7cac220b3b9716f9e7c7fbcbceb69ab3a20033cc2',
    );
}

// deploy the zoracoin

async function deployZora(data) {
    console.log(
        'CALLING: deployZora for tweet:',
        tweetUrl.creatorTweet.username,
        tweetUrl.creatorTweet.id,
    );
    // get metadata first it's then added to data.metadata
    const { name, symbol, minter, creator, minterAddress, creatorAddress } =
        await getMetadata(data);
    console.log('getMetadata', name, symbol);

    if (TEST_METADATA) {
        return;
    }

    const cid = await pinataUpload(data);
    console.log('pinataUpload cid', cid);
    if (TEST_PINATA) {
        return;
    }
    const uri = `https://ipfs.io/ipfs/${cid}`;

    // the shade agent is the only one deriving the account to sign for zoracoin mints, we'll fund this address
    // generate address independently by calling /api/address
    const path = 'zoracoin';
    const { address } = await generateAddress({
        publicKey:
            networkId === 'testnet'
                ? process.env.MPC_PUBLIC_KEY_TESTNET
                : process.env.MPC_PUBLIC_KEY_MAINNET,
        accountId: process.env.NEXT_PUBLIC_contractId,
        path,
        chain: 'evm',
    });

    // TESTING get logs for zora hash

    const { hash, tx, explorerLink } = await evm.deployZora({
        path,
        name,
        address,
        symbol,
        minter: minterAddress,
        creator: creatorAddress,
        address,
        uri,
    });

    // generate last tweet in conversation thread
    // find new coin address from tx (if possible)
    const coinAddress = await getCoinAddressFromLogs(hash, tx.blockNumber);
    const lastTweet = await getLatestConversationTweet(
        await getClient(),
        data.creatorTweet.id,
    );
    if (coinAddress) {
        await replyToTweet(
            `Coined it!\nhttps://zora.co/coin/base:${coinAddress}\nToken name: ${name} \nSymbol: ${symbol}!`,
            lastTweet,
        );
    } else {
        await replyToTweet(
            `Coined it!\n${explorerLink}\nToken name: ${name} \nSymbol: ${symbol}!`,
            lastTweet,
        );
    }
}

if (TEST_METADATA || TEST_PINATA || TEST_DEPLOY) {
    deployZora({
        creatorTweet: {
            text: 'Hello world!',
            username: 'mattdlockyer',
            address: '0xa29CcdCc81C327d2203B7A93b6b8677c943d1E76',
            imageUrl:
                'https://pages.near.org/wp-content/uploads/2025/04/near_edDSA_social-graphic.png',
        },
        minterTweet: {
            text: 'Woo!',
            username: 'kendaIIc',
            address: '0xa29CcdCc81C327d2203B7A93b6b8677c943d1E76',
        },
    });
}

// this queue is for processing replies from @bankrbot after we asked it for 2 evm addresses

async function processBankrReply() {
    const data = pendingBankrReply.shift();
    if (!data) {
        return sleepThen(PENDING_BANKR_ADDRESSES_DELAY, processBankrReply);
    }
    const timeDiffMins =
        (new Date() - new Date(data.bankrReply.created_at)) / 60000;
    // bail after waiting 15 minutes for bankrbot
    if (timeDiffMins > 15) {
        console.log(
            'TIMEOUT: exceeded 15m for @bankrbot reply to tweet:',
            tweetUrl(BOT_USERNAME, data.bankrReply.id),
        );
        return sleepThen(PENDING_BANKR_ADDRESSES_DELAY, processBankrReply);
    }
    // only start searching for tweets after 1 minute (give bankrbot time)
    if (timeDiffMins < 1) {
        pendingBankrReply.push(data);
        return sleepThen(PENDING_BANKR_ADDRESSES_DELAY, processBankrReply);
    }

    console.log(
        'waiting on @bankrbot reply to tweet:',
        tweetUrl(BOT_USERNAME, data.bankrReply.id),
    );
    const tweet = await getReplyToTweetFromAuthor(
        await getClient(),
        data.bankrReply.id,
        BANKR_BOT_ID,
    );
    // no tweet yet keep searching
    if (!tweet) {
        pendingBankrReply.push(data);
        return sleepThen(PENDING_BANKR_ADDRESSES_DELAY, processBankrReply);
    }

    try {
        // parse bankr reply to get addresses
        const addresses = tweet.text.match(/0x[a-fA-F0-9]{40}/gim);
        console.log('@bankrbot replied with addresses:', addresses);

        if (addresses.length !== 2) {
            console.log('missing addresses');
            return;
        }

        data.creatorTweet.address = addresses[0];
        data.minterTweet.address = addresses[1];

        deployZora(data);
    } catch (e) {
        console.log('problem getting addresses from bankrbot tweet', e);
    }

    // keep processing queue
    return sleepThen(PENDING_BANKR_ADDRESSES_DELAY, processBankrReply);
}
if (TEST_BANKR_REPLY) {
    // this will error in the try catch above because there's no creatorTweet object (ok for testing this case only)
    pendingBankrReply.push({
        bankrReply: {
            id: '1918312162994606095',
            created_at: '2025-05-02T14:31:27.457Z',
        },
    });
}
processBankrReply();

async function getBankrAddresses(data) {
    if (NO_REPLY) {
        return console.log({ NO_REPLY });
    }

    const minterTweetId = data.minterTweet.id;
    const res = await replyToTweet(
        `@bankrbot what are the Base addresses for @${data.creatorTweet.username} and @${data.minterTweet.username}?`,
        minterTweetId,
    );
    if (!res) {
        console.log('X ERROR: cannot send @bankrbot address tweet');
    }
    const bankrReply = res.data;
    // store created_at here so we can time bankrbot reply search
    bankrReply.created_at = addOneSecond(new Date().toISOString());
    console.log('bankrReply', bankrReply);

    // start looking for bankrReplies
    pendingBankrReply.push({
        ...data,
        bankrReply,
    });
}

export default async function zoracoin(req, res) {
    if (NO_SEARCH) {
        return res.status(200).json({ NO_SEARCH });
    }

    const client = await getClient();

    const start_time = addOneSecond(lastTweetTimestamp);

    const minterTweets = await client.v2.search(
        `${BOT_USERNAME} ${SEARCH_TERM}`,
        {
            start_time: USE_START_TIME ? start_time : undefined,
            'tweet.fields':
                'author_id,created_at,referenced_tweets,conversation_id',
        },
    );

    let seen = 0;
    const limit = 1;
    let latestValidTimestamp;
    // in this batch of search results store candidates for a zora mint
    let candidates = [];
    for await (let minterTweet of minterTweets) {
        if (++seen > limit) break;

        console.log('checking minterTweet.id:', minterTweet.id);

        try {
            // store the time of the minterTweet we look at and then update start_time in search next time
            if (!latestValidTimestamp) {
                latestValidTimestamp = minterTweet.created_at;
            }

            // did they reply to a tweet?
            let replied_to = minterTweet.referenced_tweets.filter(
                (t) => t.type === 'replied_to',
            )?.[0]?.id;
            // it may be that it's type is 'retweeted' or something else in which case let's just accept any referenced tweet
            if (!replied_to) {
                replied_to = minterTweet.referenced_tweets?.[0]?.id;
            }
            // we only consider reply tweets matching SEARCH_TERM
            if (typeof replied_to !== 'string') {
                console.log('not a reply tweet');
                continue;
            }

            // get the creatorTweet
            let creatorTweet = await client.v2.singleTweet(replied_to, {
                expansions: 'attachments.media_keys',
                'media.fields': 'type,url',
                'tweet.fields':
                    'author_id,created_at,referenced_tweets,conversation_id,entities',
            });
            if (!creatorTweet) {
                console.log('creatorTweet could not be found');
                continue;
            }
            // grab the media from the includes field
            const firstMedia = creatorTweet.includes?.media[0];
            // overwrite the creatorTweet to include only the tweet data now so the object is the same as minterTweet
            creatorTweet = creatorTweet.data;

            // seen creatorTweet before?
            const candidate = candidates.find(
                (c) => c.creatorTweet.id === creatorTweet.id,
            );
            if (candidate !== undefined) {
                // SWAPPING minterTweet is date is less than the candidate minterTweet meaning it was first
                if (
                    new Date(minterTweet.created_at) <
                    new Date(candidate.minterTweet.created_at)
                ) {
                    const index = candidates.findIndex(
                        (c) => c.creatorTweet.id === creatorTweet.id,
                    );
                    // remove the candidate from the array (added back after usernames are added below)
                    candidates.splice(index, 1);
                    // swap in candidate tweets
                    minterTweet = candidate.minterTweet;
                    creatorTweet = candidate.creatorTweet;
                }
            } else {
                // process creatorTweet and store candiate zora mint
                // default to tweet text as content
                let mintData = creatorTweet.text;
                if (firstMedia === undefined) {
                    console.log('no media for tweet, using tweet text');
                    // DISCARD
                    // WHY? creatorTweet is only text and includes the SEARCH TERM
                    const replied_to = creatorTweet.referenced_tweets.filter(
                        (t) => t.type === 'replied_to',
                    )?.[0]?.id;
                    if (
                        typeof replied_to === 'string' &&
                        /mint it/gim.test(creatorTweet.text)
                    ) {
                        console.log('creator tweet is another "mint it" reply');
                        continue;
                    }
                } else {
                    creatorTweet.imageUrl = firstMedia.url;
                    // mint anything with media
                    mintData = await fetch(firstMedia.url).then((r) =>
                        r.arrayBuffer(),
                    );
                    console.log(
                        'found media in tweet with bytelength',
                        mintData.byteLength,
                    );
                }
                creatorTweet.mintData = mintData;
            }

            // get handles for the creator and the minter
            const users = await client.v2.users(
                [creatorTweet.author_id, minterTweet.author_id],
                {
                    'user.fields': 'username',
                },
            );
            if (!users?.data || users.data.length < 2) {
                console.log(
                    'X ERROR: getting usernames for creator and minter',
                );
                continue;
            }
            const [creatorUsername, minterUsername] = users.data.map(
                (u) => u.username,
            );
            minterTweet.username = minterUsername;
            creatorTweet.username = creatorUsername;

            if (
                ALLOWED_USERNAMES?.length > 0 &&
                !ALLOWED_USERNAMES.includes(minterTweet.username)
            ) {
                console.log(
                    'ALLOWED_USERNAMES ACTIVE: username not valid:',
                    minterTweet.username,
                );
                continue;
            }

            console.log('candidate found');
            console.log(
                'creator tweet',
                tweetUrl(creatorTweet.username, creatorTweet.id),
            );

            // push the candidate
            candidates.push({
                creatorTweet,
                minterTweet,
            });
        } catch (e) {
            console.log('problem getting data from tweet');
            // TODO reply to minterTweet
        }
    }

    // start processing mint, stagger start bc of tweets to bankrbot
    candidates.forEach((c, i) =>
        setTimeout(() => getBankrAddresses(c), i * 2000),
    );

    // store for next search start_time
    lastTweetTimestamp = latestValidTimestamp;

    res.status(200).json({ success: candidates.length });
}
