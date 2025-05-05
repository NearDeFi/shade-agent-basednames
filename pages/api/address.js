import { networkId, generateAddress } from '@neardefi/shade-agent-js';

export default async function address(req, res) {
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

    res.status(200).json({ address });
}
