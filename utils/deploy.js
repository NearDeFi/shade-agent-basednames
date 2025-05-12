import fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: './.env.development.local' });
import { parseSeedPhrase } from 'near-seed-phrase';
import * as nearAPI from 'near-api-js';
const { Near, Account, KeyPair, keyStores } = nearAPI;

const networkId = 'mainnet';
const accountId = process.env.NEAR_ACCOUNT_ID;
const contractId = process.env.NEXT_PUBLIC_contractId;

const { secretKey } = parseSeedPhrase(process.env.NEAR_SEED_PHRASE);
const keyStore = new keyStores.InMemoryKeyStore();
const keyPair = KeyPair.fromString(secretKey);
keyStore.setKey(networkId, accountId, keyPair);
keyStore.setKey(networkId, contractId, keyPair);

const config = {
    networkId,
    keyStore,
    nodeUrl: 'https://rpc.near.org',
    walletUrl: 'https://mynearwallet.com/',
    explorerUrl: 'https://nearblocks.io',
};
const near = new Near(config);
const { connection } = near;
const gas = BigInt('300000000000000');

export const getAccount = (id) => new Account(connection, id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const deploy = async () => {
    try {
        const account = getAccount(contractId);
        await account.deleteAccount(accountId);
    } catch (e) {
        console.log('error deleteAccount', e);
    }

    await sleep(1000);

    try {
        const account = getAccount(accountId);
        await account.createAccount(
            contractId,
            keyPair.getPublicKey(),
            nearAPI.utils.format.parseNearAmount('10'),
        );
    } catch (e) {
        console.log('error createAccount', e);
    }

    await sleep(1000);

    const file = fs.readFileSync('./contract/target/near/contract.wasm');
    let account = getAccount(contractId);
    await account.deployContract(file);
    console.log('deployed bytes', file.byteLength);
    const balance = await account.getAccountBalance();
    console.log('contract balance', balance);

    await sleep(1000);

    const initRes = await account.functionCall({
        contractId,
        methodName: 'init',
        args: {
            owner_id: accountId,
        },
        gas,
    });

    console.log('initRes', initRes);

    await sleep(1000);
    // NEEDS TO MATCH docker-compose.yaml CODEHASH
    const codehash =
        'd1ba9589aad6c3b32a4e39daa871697a0a9baec17549ebb51716cb368c80e4a4';
    account = getAccount(accountId);
    const approveRes = await account.functionCall({
        contractId,
        methodName: 'approve_codehash',
        args: {
            codehash,
        },
        gas,
    });

    console.log('approveRes', approveRes);
};

deploy();
