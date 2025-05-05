import { PinataSDK } from 'pinata';
import { genMetadata } from './openai';

export async function getMetadata(data) {
    const minter = data.minterTweet.username;
    const creator = data.creatorTweet.username;

    // openai gen, might not return accurate results, use defaults
    let { name, symbol } = await genMetadata(
        data.creatorTweet.text,
        data.creatorTweet.imageUrl,
    );
    // something went wrong with openai call and we got empty object
    if (!name || !symbol) {
        name = `@${creator} x @${minter}`;
        symbol = (
            creator.substring(0, 2) + minter.substring(0, 2)
        ).toUpperCase();
    }

    data.metadata = {
        minter,
        creator,
        name,
        symbol,
        minterAddress: data.minterTweet.address,
        creatorAddress: data.creatorTweet.address,
        description: `Basednames X Mint. Created by @${creator}. Minted by @${minter}.`,
    };

    return data.metadata;
}
const pinata = new PinataSDK({
    pinataJwt: process.env.PINATA_API_JWT,
    pinataGateway: process.env.PINATA_API_GATEWAY,
});

export async function uploadImageFromData(data) {
    const { name, description } = data.metadata;

    const blob = new Blob([data.creatorTweet.mintData], { type: 'image/jpeg' });
    const file = new File([blob], 'mintImage.jpg', { type: 'image/jpeg' });

    const { cid: fileCID } = await pinata.upload.public.file(file);

    const { cid } = await pinata.upload.public.json({
        name,
        description,
        image: `ipfs://${fileCID}`,
        content: {
            mime: 'image/jpeg',
            uri: `ipfs://${fileCID}`,
        },
        properties: {
            category: 'social',
        },
    });
    return cid;
}

export async function uploadTextFromData(data) {
    const { name, description } = data.metadata;

    const file = new File([data.creatorTweet.mintData], 'mintText.txt', {
        type: 'text/plain',
    });
    const { cid: fileCID } = await pinata.upload.public.file(file);

    console.log(fileCID);

    const { cid } = await pinata.upload.public.json({
        name,
        description,
        content: {
            mime: 'text/plain',
            uri: `ipfs://${fileCID}`,
        },
        properties: {
            category: 'social',
        },
    });
    return cid;
}

// switch for promised methods above

export function pinataUpload(data) {
    if (!data.metadata) {
        return console.log('Call getMetadata first');
    }
    if (typeof data.creatorTweet.mintData === 'string') {
        return uploadTextFromData(data);
    } else {
        return uploadImageFromData(data);
    }
}
