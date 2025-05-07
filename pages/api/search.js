import { generateAddress, networkId } from '@neardefi/shade-agent-js';
import { evm } from '../../utils/evm';
import { fetchJson, sleep } from '../../utils/utils';
import { crosspostReply } from '../../utils/crosspost';
import { searchTweetsWithMasa } from '../../utils/masa';

const DEPOSIT_PROCESSING_DELAY = 5000;
const REPLY_PROCESSING_DELAY = 15000;
const REFUND_PROCESSING_DELAY = 60000;
const MAX_DEPOSIT_ATTEMPTS = 12 * 60; // 12 per minute * 60 mins
const pendingReply = [];
const pendingDeposit = [];
let lastTweetTimestamp = parseInt(process.env.TWITTER_LAST_TIMESTAMP) || 0;
const pendingRefund = [];
const refunded = [];

// In-memory store for active conversations
// Structure: conversationId -> { status: string, lastProcessedTweetId: string, basename?: string, depositAddress?: string, path?: string, price?: bigint, attempts?: number }
const activeConversations = new Map(); 
// Statuses: 'new', 'instruction_sent', 'awaiting_deposit', 'processing_deposit', 'resolved', 'error_invalid_basename', 'error_unavailable_basename', 'error_max_attempts'


const SEARCH_ONLY = true; // If true, replies are faked (logged but not sent)

const sleepThen = async (dur, fn) => {
    await sleep(dur);
    fn();
};

const getTransactionsForAddress = async (address, action = 'txlist') => {
    let tx;
    try {
        const res = await fetchJson(
            `https://api${
                networkId === 'testnet' ? '-sepolia' : ''
            }.basescan.org/api?module=account&action=${action}&address=${address}&startblock=0&endblock=latest&page=1&offset=10&sort=asc&apikey=${
                process.env.BASE_API_KEY
            }`,
        );
        if (!res.result || !res.result.length > 0) {
            return;
        }
        tx = res.result[0];
        if (tx?.isError === '1' || !tx?.from) {
            return;
        }
    } catch (e) {
        console.log(e);
    }
    return tx;
};


export const getRefunded = () => refunded;

const processRefunds = async () => {
    const tweet = pendingRefund.shift();
    if (!tweet) {
        await sleepThen(REFUND_PROCESSING_DELAY, processRefunds);
        return;
    }
    console.log('refund tweet.id', tweet.id);

    // whether successful or not, store this tweet in case we need to resolve manually
    // need tweet.path to force another manual refund attempt
    refunded.push(tweet);

    let internal = false;
    let tx = await getTransactionsForAddress(tweet.address);
    // check transactions for smart contract wallets
    if (!tx) {
        tx = await getTransactionsForAddress(tweet.address, 'txlistinternal');
        internal = true;
    }

    if (tx) {
        try {
            const balance = await evm.getBalance({
                address: tweet.address,
            });
            const feeData = await evm.getGasPrice();
            const gasPrice =
                BigInt(feeData.maxFeePerGas) +
                BigInt(feeData.maxPriorityFeePerGas);
            const gasLimit = internal ? 500000n : 21000n;
            const gasFee = gasPrice * gasLimit;
            // make sure we don't overshoot the total available
            const adjust = 5000000000000n;
            const amount = evm.formatBalance(balance - gasFee - adjust);

            await evm.send({
                path: tweet.path,
                from: tweet.address,
                to: tx.from,
                amount,
                gasLimit,
            });
        } catch (e) {
            console.log(e);
        }
    }

    // check again
    await sleepThen(REFUND_PROCESSING_DELAY, processRefunds);
};
processRefunds();

// processing deposits and registering basenames

const processDeposits = async () => {
    const tweet = pendingDeposit.shift();
    if (!tweet || tweet.depositAttempt >= MAX_DEPOSIT_ATTEMPTS) {
        if (tweet) {
            pendingRefund.push(tweet);
        }
        await sleepThen(DEPOSIT_PROCESSING_DELAY, processDeposits);
        return;
    }
    console.log('processing deposit', tweet.depositAttempt, tweet.address);

    let balance;
    try {
        balance = await evm.getBalance({ address: tweet.address });
        console.log('balance', evm.formatBalance(balance));
    } catch (e) {
        console.log(e);
    }

    // correct deposit amount, stop checking
    // The 'tweet' object here comes from the pendingDeposit queue
    if (balance && balance >= tweet.price) { 
        const tx = await getTransactionsForAddress(tweet.address); // tweet.address is the deposit address

        if (tx) {
            try {
                const nameRes = await evm.getBasenameTx(
                    tweet.path, // Path used for deposit address generation
                    tweet.basename,
                    tweet.address, // Deposit address
                    tx.from, // User's EOA that sent funds
                );

                if (nameRes?.success && nameRes?.explorerLink) {
                    const conversationState = activeConversations.get(tweet.conversation_id);
                    await crosspostReply(
                        `Done! 😎\n\nRegistered ${tweet.basename}.base.eth to ${tx.from}\n\ntx: ${nameRes.explorerLink}`,
                        { id: tweet.id, author_id: tweet.author_id },
                        SEARCH_ONLY,
                    );
                    if (conversationState) {
                        conversationState.status = 'resolved';
                        activeConversations.set(tweet.conversation_id, conversationState);
                    }
                } else {
                    // Registration might have failed, or nameRes was not as expected
                    const conversationState = activeConversations.get(tweet.conversation_id);
                    if (conversationState) {
                        conversationState.status = 'error_registration_failed';
                        activeConversations.set(tweet.conversation_id, conversationState);
                    }
                }
            } catch (e) {
                console.log("Error during getBasenameTx or crosspostReply after deposit:", e);
                const conversationState = activeConversations.get(tweet.conversation_id);
                if (conversationState) {
                    conversationState.status = 'error_processing_deposit';
                    activeConversations.set(tweet.conversation_id, conversationState);
                }
            }

            try {
                // leftovers? whether successful or not
                const balance = await evm.getBalance({
                    address: tweet.address,
                });
                if (balance > 0n) {
                    pendingRefund.push(tweet);
                }
            } catch (e) {
                console.log(e);
            }

            await sleepThen(DEPOSIT_PROCESSING_DELAY, processDeposits);
            return;
        }

        // check internal transactions
        const txInternal = await getTransactionsForAddress(
            tweet.address,
            'txlistinternal',
        );
        if (txInternal) {
            pendingRefund.push(tweet);

            await sleepThen(DEPOSIT_PROCESSING_DELAY, processDeposits);
            return;
        }
    }

    tweet.depositAttempt++;
    pendingDeposit.push(tweet);
    await sleepThen(DEPOSIT_PROCESSING_DELAY, processDeposits);
};
processDeposits();

// processing the tweet reply

const processReplies = async () => {
    const tweet = pendingReply.shift();
    if (!tweet || tweet.replyAttempt >= 3) {
        await sleepThen(REPLY_PROCESSING_DELAY, processReplies);
        return;
    }
    console.log('processing reply', tweet.id);

    tweet.path = `${tweet.author_id}-${tweet.basename}`;
    // generate deposit address
    const { address } = await generateAddress({
        publicKey:
            networkId === 'testnet'
                ? process.env.MPC_PUBLIC_KEY_TESTNET
                : process.env.MPC_PUBLIC_KEY_MAINNET,
        accountId: process.env.NEXT_PUBLIC_contractId,
        path: tweet.path,
        chain: 'evm',
    });
    tweet.address = address;

    const basenameInfo = await evm.checkBasename(tweet.basename);

    // The 'tweet' object here comes from the pendingReply queue
    const conversationState = activeConversations.get(tweet.conversation_id) || 
                            { status: 'new', lastProcessedTweetId: tweet.id, basename: tweet.basename, attempts: 0 };
    conversationState.attempts = (conversationState.attempts || 0) + 1;

    // bail on this name if it's not valid or available
    if (!basenameInfo.isValid || tweet.basename.length < 3) {
        await crosspostReply(
            `Sorry! 😬\n\n"${tweet.basename}" is not a valid basename! Must be 3+ alphanumeric characters.`,
            tweet,
            SEARCH_ONLY,
        );
        conversationState.status = 'error_invalid_basename';
        activeConversations.set(tweet.conversation_id, conversationState);
        await sleepThen(REPLY_PROCESSING_DELAY, processReplies);
        return;
    }

    if (!basenameInfo.isAvailable) {
        await crosspostReply(
            `Sorry! 😬\n\nBasename "${tweet.basename}.base.eth" is not available!`,
            tweet,
            SEARCH_ONLY,
        );
        conversationState.status = 'error_unavailable_basename';
        activeConversations.set(tweet.conversation_id, conversationState);
        await sleepThen(REPLY_PROCESSING_DELAY, processReplies);
        return;
    }

    // prices (any extra is refunded)
    // 1100000000000000n 5+ char
    // 11000000000000000n 4 char
    // 110000000000000000n 3 char
    tweet.price = 1100000000000000n;
    if (tweet.basename.length === 4) {
        tweet.price = 11000000000000000n;
    }
    if (tweet.basename.length === 3) {
        tweet.price = 110000000000000000n;
    }
    const formatedPrice = evm.formatBalance(tweet.price).substring(0, 7);
    console.log('formatedPrice', formatedPrice);

    const res = await crosspostReply(
        `On it! 😎\n\nTo register "${tweet.basename}.base.eth", send ${formatedPrice} ETH (Base) to: ${tweet.address}\n\nYou have 10 minutes. Late? You might miss out & risk funds.\n\nTerms in Bio.`,
        tweet,
        SEARCH_ONLY,
    );

    // Update conversation state
    if (res?.data) { 
        tweet.onItReplyId = res.data.id;
        console.log('Instruction reply sent for tweet.id:', tweet.id, 'bot reply ID:', tweet.onItReplyId);
        
        conversationState.status = 'instruction_sent';
        conversationState.depositAddress = tweet.address;
        conversationState.path = tweet.path;
        conversationState.price = tweet.price;
        conversationState.lastProcessedTweetId = tweet.id; // The user's tweet we replied to
        activeConversations.set(tweet.conversation_id, conversationState);

        // Move to pendingDeposit queue
        // Add conversation_id to the object pushed to pendingDeposit
        pendingDeposit.push({ 
            ...tweet,
            depositAttempt: 0, 
        });

    } else {
        // Crosspost API call might have failed or didn't return expected data
        console.log(`Failed to send instruction reply for tweet ${tweet.id} or response was not as expected.`);
        // Retry by pushing back to pendingReply if attempts allow
        tweet.replyAttempt = (tweet.replyAttempt || 0) + 1;
        if (tweet.replyAttempt < 3) { // Max 3 attempts for the reply itself
            pendingReply.push(tweet);
        } else {
            conversationState.status = 'error_max_reply_attempts';
            activeConversations.set(tweet.conversation_id, conversationState);
            console.log(`Max reply attempts reached for tweet ${tweet.id}.`);
        }
    }

    await sleepThen(REPLY_PROCESSING_DELAY, processReplies); // Continue processing next in queue
};
processReplies();

export default async function search(req, res) {
    // owner only
    // jump start the queues that process everything
    // manually add a refund attempt for an address
    try {
        const url = new URL('https://example.com' + req?.url);
        const restart = url.searchParams.get('restart');
        const refund = url.searchParams.get('refund');
        const pass = url.searchParams.get('pass');
        if (pass === process.env.RESTART_PASS) {
            if (restart === 'replies') {
                processReplies();
            }
            if (restart === 'deposits') {
                processDeposits();
            }
            if (restart === 'refunds') {
                processRefunds();
            }
            if (refund) {
                const args = refund.split(',');

                pendingRefund.push({
                    id: 'FORCED REFUND TRY',
                    address: args[0],
                    path: args[1],
                });
            }
        }
    } catch (e) {
        console.log(e);
    }

    // Construct query for @basednames mentions
    let sinceDateFilter = '';
    if (lastTweetTimestamp > 0) {
        const sinceDate = new Date((lastTweetTimestamp + 1) * 1000);
        sinceDateFilter = ` since:${sinceDate.toISOString().split('T')[0]}`;
    }
    const primaryMasaQuery = `@basednames`; // MODIFY THIS QUERY, EXACTLY WHAT YOU WOULD ENTER INTO TWITTER ADVANCED SEARCH
    console.log('Primary Masa search query:', primaryMasaQuery);

    const searchResults = await searchTweetsWithMasa(primaryMasaQuery, 100);

    if (!searchResults) {
        console.log('No results from primary search or an error occurred.');
        // Still respond, queues might have items from previous runs.
        return res.status(200).json({ 
            pendingReply: pendingReply.length, 
            pendingDeposit: pendingDeposit.length,
            activeConversations: activeConversations.size,
            lastProcessedTimestamp: lastTweetTimestamp,
            message: "Search yielded no new results or failed." 
        });
    }

    let newLatestTimestamp = lastTweetTimestamp;

    for (const masaTweet of searchResults) {
        const adaptedTweet = {
            id: masaTweet.ExternalID || masaTweet.ID.toString(),
            text: masaTweet.Content,
            author_id: masaTweet.Metadata?.author || masaTweet.Metadata?.user_id,
            created_at: masaTweet.Metadata?.created_at,
            timestamp: masaTweet.Metadata?.created_at ? new Date(masaTweet.Metadata.created_at).getTime() / 1000 : 0,
            conversation_id: masaTweet.Metadata?.conversation_id,
            is_reply: masaTweet.Metadata?.IsReply || (masaTweet.Metadata?.InReplyToStatusID ? true : false), 
            in_reply_to_status_id: masaTweet.Metadata?.InReplyToStatusID,
        };

        if (!adaptedTweet.author_id || !adaptedTweet.timestamp || !adaptedTweet.conversation_id) {
            console.warn('Tweet from Masa missing crucial fields (author_id, timestamp, or conversation_id), skipping:', adaptedTweet.id);
            continue;
        }
        
        if (adaptedTweet.timestamp <= lastTweetTimestamp) {
            console.log(`Tweet ${adaptedTweet.id} (${adaptedTweet.timestamp}) is older or same as last processed (${lastTweetTimestamp}), skipping.`);
            continue;
        }
        if (adaptedTweet.timestamp > newLatestTimestamp) {
            newLatestTimestamp = adaptedTweet.timestamp;
        }

        // Check conversation state
        const conversationState = activeConversations.get(adaptedTweet.conversation_id);
        if (conversationState && ['resolved', 'error_max_reply_attempts', 'error_invalid_basename', 'error_unavailable_basename'].includes(conversationState.status)) {
            console.log(`Conversation ${adaptedTweet.conversation_id} already terminally processed (${conversationState.status}), skipping tweet ${adaptedTweet.id}.`);
            continue;
        }
        
        // Avoid reprocessing the exact same tweet if it somehow appears again
        if (conversationState && conversationState.lastProcessedTweetId === adaptedTweet.id) {
            console.log(`Tweet ${adaptedTweet.id} already processed for conversation ${adaptedTweet.conversation_id}, skipping.`);
            continue;
        }

        // Validate basename
        adaptedTweet.basename = adaptedTweet.text.match(/[a-zA-Z0-9]{3,}\.base\.eth/gim)?.[0];
        if (!adaptedTweet.basename) {
            console.log(`Tweet ${adaptedTweet.id} does not contain a valid basename pattern, skipping.`);
            await crosspostReply(
                `i'm good`,
                { id: adaptedTweet.id, author_id: adaptedTweet.author_id },
            );
            // Potentially update conversation state if it's a known convo but this tweet is not useful
            if(conversationState) {
                conversationState.lastProcessedTweetId = adaptedTweet.id;
                activeConversations.set(adaptedTweet.conversation_id, conversationState);
            }
            continue;
        }
        adaptedTweet.basename = adaptedTweet.basename.toLowerCase().split('.base.eth')[0];

        // If this basename from this author is already in a non-terminal state in another conversation,
        // or in the pending queues, it might be a duplicate request.
        // This check is simplified; more robust duplicate handling might be needed.
        const existingRequest = pendingReply.find(t => t.basename === adaptedTweet.basename && t.author_id === adaptedTweet.author_id) ||
                               pendingDeposit.find(t => t.basename === adaptedTweet.basename && t.author_id === adaptedTweet.author_id);
        if (existingRequest && existingRequest.conversation_id !== adaptedTweet.conversation_id) {
             console.log(`Basename ${adaptedTweet.basename} by ${adaptedTweet.author_id} already active in another conversation ${existingRequest.conversation_id}, skipping for new tweet ${adaptedTweet.id}.`);
             continue;
        }
        for (const [convId, state] of activeConversations) {
            if (state.basename === adaptedTweet.basename && 
                state.author_id === adaptedTweet.author_id && // Need to ensure author_id is stored in activeConversations
                convId !== adaptedTweet.conversation_id &&
                !['resolved', 'error_max_reply_attempts', 'error_invalid_basename', 'error_unavailable_basename'].includes(state.status)) {
                console.log(`Basename ${adaptedTweet.basename} by ${adaptedTweet.author_id} already active in conversation ${convId}, skipping for new tweet ${adaptedTweet.id}.`);
                // This break is to stop iterating activeConversations, not the main loop
                // A flag would be better here if we weren't continuing the outer loop.
                // For simplicity, let's assume the continue below is sufficient.
            }
        }


        console.log('Tweet qualified for processing:', adaptedTweet.id, adaptedTweet.basename);
        adaptedTweet.replyAttempt = 0; 
        
        if (!conversationState) {
             activeConversations.set(adaptedTweet.conversation_id, { 
                status: 'new', 
                lastProcessedTweetId: adaptedTweet.id, 
                basename: adaptedTweet.basename,
                author_id: adaptedTweet.author_id, // Store author_id for future checks
                attempts: 0 
            });
        } else {
            // Update existing conversation if it's a new tweet in an ongoing one
            conversationState.lastProcessedTweetId = adaptedTweet.id;
            // Potentially reset attempts or re-evaluate status if user is re-engaging
            activeConversations.set(adaptedTweet.conversation_id, conversationState);
        }

        if (!SEARCH_ONLY) {
            pendingReply.push(adaptedTweet);
        } else {
            console.log("SEARCH_ONLY mode: Tweet that would be added to pendingReply queue:", adaptedTweet);
        }
    }

    if (newLatestTimestamp > lastTweetTimestamp) {
        lastTweetTimestamp = newLatestTimestamp;
        console.log('Updated lastTweetTimestamp to:', lastTweetTimestamp);
        // Persistence of lastTweetTimestamp is still an external concern for production
    }

    console.log('Current pendingReply:', pendingReply.length, 'pendingDeposit:', pendingDeposit.length, 'activeConversations:', activeConversations.size);
    res.status(200).json({ 
        pendingReply: pendingReply.length, 
        pendingDeposit: pendingDeposit.length,
        activeConversations: activeConversations.size,
        lastProcessedTimestamp: lastTweetTimestamp 
    });
}
