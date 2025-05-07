import { CrosspostClient } from "@crosspost/sdk";
import { Platform } from "@crosspost/types";
import { sha256 } from "@noble/hashes/sha2";
import * as borsh from "borsh";
import * as nearAPI from "near-api-js";
import { generateNonce, uint8ArrayToBase64 } from "near-sign-verify";

let clientInstance = null;

/**
 * Gets or creates a singleton CrosspostClient instance.
 * @returns {CrosspostClient} The CrosspostClient instance.
 */
const getClientInstance = () => {
  if (!clientInstance) {
    clientInstance = new CrosspostClient();
  }
  return clientInstance;
};

/**
 * Generates authentication data for Crosspost API.
 * @returns {Promise<object>} The authentication data object.
 */
const getAuthData = async () => {
  // START : DO NOT CHANGE THIS
  // This is used to sign the authentication signature needed for the crosspost API
  const message = "Post";
  const nonce = generateNonce();
  const recipient = "crosspost.near";
  const accountId = process.env.CROSSPOST_SIGNER_ID;
  const keyPairString = process.env.CROSSPOST_KEYPAIR;

  if (!accountId || !keyPairString) {
    console.error(
      "CROSSPOST_SIGNER_ID or CROSSPOST_KEYPAIR environment variables are not set."
    );
    throw new Error("Crossposting credentials not configured.");
  }

  let authData;

  try {
    const signer = nearAPI.KeyPair.fromString(keyPairString);

    const TAG = 2147484061; // Magic number for verification

    const payload = {
      tag: TAG,
      message,
      nonce: Array.from(nonce),
      receiver: recipient,
      callback_url: null,
    };

    const schema = {
      struct: {
        tag: "u32",
        message: "string",
        nonce: { array: { type: "u8", len: 32 } },
        receiver: "string",
        callback_url: { option: "string" },
      },
    };

    const serializedPayload = borsh.serialize(schema, payload);
    const payloadHash = sha256(serializedPayload);
    const signedMessage = signer.sign(payloadHash);

    authData = {
      message,
      nonce: nonce,
      recipient,
      callback_url: "",
      signature: uint8ArrayToBase64(signedMessage.signature),
      account_id: accountId,
      public_key: signedMessage.publicKey.toString(),
    };
  } catch (e) {
    console.log("Error creating auth token for crossposting...", e);
    throw new Error("Error creating crossposting auth token.");
  }
  // END : DO NOT CHANGE THIS
  return authData;
};

export const crosspostReply = async (
  text,
  tweetToReplyTo,
  fakeReply = false
) => {
  console.log("crosspostReply to tweet ID:", tweetToReplyTo.id);

  if (fakeReply) {
    console.log(
      `FAKE_REPLY: Would reply to ${tweetToReplyTo.id} with: ${text}`
    );
    return { data: { id: "fake_reply_id" } };
  }

  if (!process.env.BOT_TWITTER_USER_ID) {
    console.warn(
      "BOT_TWITTER_USER_ID environment variable is not set. Crossposting target userId might be incorrect."
    );
    throw new Error(
      `Bot twitter user id must be provided: ${process.env.BOT_TWITTER_USER_ID}`
    );
  }

  try {
    // you should sign (getAuthData) and setAuthentication before each request
    const client = getClientInstance();
    const authData = await getAuthData();
    await client.setAuthentication(authData);

    const replyRequest = {
      targets: [
        {
          platform: Platform.TWITTER,
          userId: process.env.BOT_TWITTER_USER_ID,
        },
      ],
      platform: Platform.TWITTER,
      postId: tweetToReplyTo.id,
      content: [
        {
          text: text,
          // media: [] // Optional: include if sending media, see here:
          // https://github.com/open-crosspost/open-crosspost-proxy-service/blob/main/packages/types/src/post.ts
        },
      ],
    };

    console.log(
      "replyToPost with request:",
      JSON.stringify(replyRequest, null, 2)
    );
    const res = await client.post.replyToPost(replyRequest);
    console.log("Crosspost reply response:", res);

    return { data: { id: res?.id } };
  } catch (e) {
    console.log("Error crossposting reply...", e);
    throw new Error("Error crossposting reply.");
  }
};

/**
 * Creates a new post using CrosspostClient.
 * @param {Array<object>} content - The content of the post. See Crosspost SDK for structure.
 * @param {Array<object>} targets - The target platforms and user IDs. See Crosspost SDK.
 * @returns {Promise<object>} The response from the Crosspost API.
 */
export const crosspostCreatePost = async (content, targets) => {
  try {
    // you should sign (getAuthData) and setAuthentication before each request
    const client = getClientInstance();
    const authData = await getAuthData();
    await client.setAuthentication(authData);

    const createRequest = {
      targets,
      content,
    };

    console.log(
      "createPost with request:",
      JSON.stringify(createRequest, null, 2)
    );
    const res = await client.post.createPost(createRequest);
    console.log("Crosspost create response:", res);

    return res;
  } catch (e) {
    console.log("Error crossposting new post...", e);
    throw new Error("Error crossposting new post.");
  }
};

