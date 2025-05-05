import { deriveWorkerAccount, getAccount } from '@neardefi/shade-agent-js';

export default async function kill(req, res) {
    const url = new URL('https://example.com' + req?.url);
    const pass = url.searchParams.get('pass');
    if (pass !== process.env.RESTART_PASS) {
        res.status(200).json({
            killed: false,
        });
    }
    const accountId = await deriveWorkerAccount();
    // delete ephemeral shade agent account on TEE and return funds to the funding account
    const account = await getAccount(accountId);
    await account.deleteAccount(process.env.NEAR_FUNDING_ACCOUNT);

    res.status(200).json({
        killed: true,
    });
}
