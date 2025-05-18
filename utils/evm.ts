import { ethers, hexlify } from 'ethers';
import {
    networkId,
    contractCall,
    parseNearAmount,
} from '@neardefi/shade-agent-js';

// CONFIG FOR ZORA COIN

// Zora contract address - replace with your actual Zora contract address
const ZORA_CONTRACT_ADDRESS = '0x777777751622c0d3258f214F9DF38E35BF45baF3';

// ABI for Zora token contract
const ZORA_CONTRACT_ABI = [
    {
        inputs: [{ internalType: 'address', name: '_logic', type: 'address' }],
        stateMutability: 'nonpayable',
        type: 'constructor',
    },
    {
        inputs: [{ internalType: 'address', name: 'target', type: 'address' }],
        name: 'AddressEmptyCode',
        type: 'error',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: 'implementation',
                type: 'address',
            },
        ],
        name: 'ERC1967InvalidImplementation',
        type: 'error',
    },
    { inputs: [], name: 'ERC1967NonPayable', type: 'error' },
    { inputs: [], name: 'FailedInnerCall', type: 'error' },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'address',
                name: 'implementation',
                type: 'address',
            },
        ],
        name: 'Upgraded',
        type: 'event',
    },
    { stateMutability: 'payable', type: 'fallback' },
];

// Adding the deploy function to the ABI
const DEPLOY_FUNCTION_ABI = [
    'function deploy(address payoutRecipient, address[] memory owners, string memory uri, string memory name, string memory symbol, address platformReferrer, address currency, int24 tickLower, uint256 orderSize) external returns (address)',
];

// CONFIG FOR BASENAMES

// Base Sepolia contract addresses from README
const REGISTRAR_CONTROLLER_ADDRESS = {
    testnet: '0x49ae3cc2e3aa768b1e5654f5d3c6002144a59581',
    mainnet: '0x4cCb0BB02FCABA27e82a56646E81d8c5bC4119a5',
}; // RegistrarController on Base Sepolia
const L2_RESOLVER_ADDRESS = {
    testnet: '0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA',
    mainnet: '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD',
}; // L2Resolver on Base Sepolia

// ABIs for Base Name Service contracts
const REGISTRAR_CONTROLLER_ABI = [
    'function valid(string memory name) public pure returns (bool)',
    'function available(string memory name) public view returns (bool)',
    'function register(RegisterRequest calldata request) public payable validRegistration(request)',
    'function rentPrice(string calldata name, uint256 duration) public view returns (IPriceOracle.Price memory price)',
    'function registerPrice(string memory name, uint256 duration) public view returns (uint256)',
];

// Define the RegisterRequest struct
const REGISTER_REQUEST_TYPE = `
tuple(
    string name,
    address owner,
    uint256 duration,
    address resolver,
    bytes[] data,
    bool reverseRecord
)
`;

const L2_RESOLVER_ABI = [
    'function setAddr(bytes32 node, address addr) external',
    'function setText(bytes32 node, string calldata key, string calldata value) external',
    'function setName(bytes32 node, string calldata name) external',
];

const getProvider = () => {
    return new ethers.JsonRpcProvider(
        networkId === 'testnet'
            ? 'https://base-sepolia-rpc.publicnode.com'
            : 'https://base-rpc.publicnode.com',
    );
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const evm = {
    name: 'Base',
    chainId: networkId === 'testnet' ? 84532 : 8453,
    currency: 'ETH',
    explorer:
        networkId === 'testnet'
            ? 'https://sepolia.basescan.org'
            : 'https://basescan.org',

    getGasPrice: async () => getProvider().getFeeData(),
    getBalance: ({ address }) => getProvider().getBalance(address),
    formatBalance: (balance) => ethers.formatEther(balance),
    getTransactionReceipt: (hash) => getProvider().getTransactionReceipt(hash),
    getLogs: (args) => getProvider().send('eth_getLogs', [args]),
    hexlify: (args) => ethers.hexlify(args),

    // custom methods for zora coin creation

    deployZora: async ({
        path,
        address,
        minter,
        creator,
        name,
        symbol,
        uri,
    }) => {
        console.log('Processing Zora token deployment request');

        try {
            const provider = getProvider();

            // Deployment parameters
            const payoutRecipient = creator;
            const owners = [creator];
            const platformReferrer = minter;
            const currency = ethers.ZeroAddress;
            const tickLower = -208200;
            const orderSize = 0;

            console.log(`Preparing to deploy Zora token with name: ${name}...`);

            // Create contract instance with combined ABI
            const zoraContract = new ethers.Contract(
                ZORA_CONTRACT_ADDRESS,
                [...ZORA_CONTRACT_ABI, ...DEPLOY_FUNCTION_ABI],
                provider,
            );

            // Log the deployment parameters
            console.log('Deployment Parameters:');
            console.log(`- Payout Recipient: ${payoutRecipient}`);
            console.log(`- Owners: ${owners.join(', ')}`);
            console.log(`- URI: ${uri}`);
            console.log(`- Name: ${name}`);
            console.log(`- Symbol: ${symbol}`);
            console.log(`- Platform Referrer: ${platformReferrer}`);
            console.log(`- Currency: ${currency}`);
            console.log(`- Tick Lower: ${tickLower}`);
            console.log(`- Order Size: ${orderSize}`);

            // // Estimate gas for the transaction (NOT WORKING)
            // let gasEstimate = await zoraContract.deploy.estimateGas(
            //     payoutRecipient,
            //     owners,
            //     uri,
            //     name,
            //     symbol,
            //     platformReferrer,
            //     currency,
            //     tickLower,
            //     orderSize,
            // );
            // console.log(`Gas estimate for deployment: ${gasEstimate}`);

            // Create contract interface
            const zoraInterface = new ethers.Interface([
                ...ZORA_CONTRACT_ABI,
                ...DEPLOY_FUNCTION_ABI,
            ]);

            // Get the network's current values
            const [chainId, nonce, feeData] = await Promise.all([
                provider.getNetwork().then((n) => n.chainId),
                provider.getTransactionCount(address),
                provider.getFeeData(),
            ]);

            // Create transaction data for deployment
            const txData = zoraInterface.encodeFunctionData('deploy', [
                payoutRecipient,
                owners,
                uri,
                name,
                symbol,
                platformReferrer,
                currency,
                tickLower,
                orderSize,
            ]);

            // Create transaction object for deploying the token
            const baseTx = {
                to: ZORA_CONTRACT_ADDRESS,
                data: txData,
                nonce,
                chainId: evm.chainId, // Base Sepolia chain ID
                type: 2, // EIP-1559 transaction
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                maxFeePerGas: feeData.maxFeePerGas,
                gasLimit: 7000000n,
                value: 0n,
            };

            // console.log(baseTx);

            console.log('Attempting Signature for Address:', address);
            const balance = await evm.getBalance({ address });
            console.log('Balance:', ethers.formatEther(balance), currency);

            return await evm.completeEthereumTx({ baseTx, path });
            // return await evm.completeEthereumTxByDirectMPC({ baseTx, path });
        } catch (error) {
            console.error('Error in Zora token deployment:', error);
            console.log(error?.info, error?.info?.payload?.params);
            return {
                success: false,
                error: error.message,
            };
        }
    },

    // custom methods for basednames registration

    checkBasename: async (basename) => {
        try {
            const provider = getProvider();

            console.log(`Checking basename: "${basename}"...`);

            const registrarController = new ethers.Contract(
                REGISTRAR_CONTROLLER_ADDRESS[networkId],
                [
                    ...REGISTRAR_CONTROLLER_ABI,
                    'function valid(string memory name) external view returns (bool)',
                    'function available(string memory name) external view returns (bool)',
                ],
                provider,
            );

            // Check if the name is valid according to contract rules
            const isValid = await registrarController.valid(basename);
            console.log(`Is "${basename}" valid format? ${isValid}`);

            if (!isValid) {
                console.error(
                    `Name "${basename}" does not meet minimum length requirement`,
                );
                return {
                    basename,
                    isValid: false,
                    isAvailable: false,
                    priceChecked: false,
                };
            }

            // Check if the name is available
            const isAvailable = await registrarController.available(basename);
            console.log(`Is "${basename}" available? ${isAvailable}`);

            if (!isAvailable) {
                console.error(`Name "${basename}" is not available`);
                return {
                    basename,
                    isValid: true,
                    isAvailable: false,
                    priceChecked: false,
                };
            }

            // Get the price for 1-year registration
            const oneYearDuration = 31536000; // 1 year in seconds
            const price = await registrarController.registerPrice(
                basename,
                oneYearDuration,
            );
            console.log(
                `Registration price for 1 year: ${ethers.formatEther(
                    price,
                )} ETH`,
            );

            return {
                basename,
                isValid,
                isAvailable,
                price,
                priceChecked: true,
            };
        } catch (error) {
            console.error(`Error checking basename "${basename}":`, error);
            return {
                basename,
                error: error.message,
            };
        }
    },

    getBasenameTx: async (path, basename, senderAddress, targetAddress) => {
        try {
            // Check basename first and handle any validation errors
            const nameCheck = await evm.checkBasename(basename);
            if (!nameCheck.isValid || !nameCheck.isAvailable) {
                console.error(
                    `Cannot proceed with registration for "${basename}"`,
                );
                return {
                    success: false,
                    reason: !nameCheck.isValid
                        ? 'Invalid name format'
                        : 'Name not available',
                };
            }

            // Create contract interfaces
            const registrarControllerInterface = new ethers.Interface([
                ...REGISTRAR_CONTROLLER_ABI,
                `function register(${REGISTER_REQUEST_TYPE}) external payable returns (uint256)`,
            ]);

            const resolverInterface = new ethers.Interface(L2_RESOLVER_ABI);

            // Set registration parameters
            const registrationDuration = 31536000; // 1 year in seconds

            const provider = getProvider();
            // Get the price for registration
            const registerPrice = await provider.call({
                to: REGISTRAR_CONTROLLER_ADDRESS[networkId],
                data: registrarControllerInterface.encodeFunctionData(
                    'registerPrice',
                    [basename, registrationDuration],
                ),
            });

            const price = ethers.toBigInt(registerPrice);
            console.log(`Registration price: ${ethers.formatEther(price)} ETH`);

            // Get the network's current values
            const [chainId, nonce, feeData] = await Promise.all([
                provider.getNetwork().then((n) => n.chainId),
                provider.getTransactionCount(senderAddress),
                provider.getFeeData(),
            ]);

            console.log('Chain ID:', chainId);

            // Calculate the namehash for {basename}.base.eth
            const namehash = ethers.namehash(`${basename}.base.eth`);

            // Prepare the data array for the registration
            const dataStruct = [
                // Create setAddr call to set the address record (ETH Address)
                resolverInterface.encodeFunctionData('setAddr', [
                    namehash,
                    targetAddress,
                ]),
            ];

            // This will allow for reverse resolution (address → name)
            const reverseName = `${basename}.base.eth`;
            dataStruct.push(
                resolverInterface.encodeFunctionData('setText', [
                    namehash,
                    'url',
                    `https://${basename}.base.eth`,
                ]),
            );

            // Create the RegisterRequest struct
            const registerRequest = {
                name: basename,
                owner: ethers.getAddress(targetAddress),
                duration: registrationDuration,
                resolver: L2_RESOLVER_ADDRESS[networkId] || ethers.ZeroAddress,
                data: dataStruct,
                reverseRecord: true,
            };

            // Encode the register function call
            const data = registrarControllerInterface.encodeFunctionData(
                'register',
                [registerRequest],
            );

            // STEP 1: Register the basename
            // Create transaction object for registering the basename
            const baseTx = {
                to: REGISTRAR_CONTROLLER_ADDRESS[networkId],
                data,
                nonce,
                chainId: evm.chainId, // Base Sepolia chain ID
                type: 2, // EIP-1559 transaction
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                maxFeePerGas: feeData.maxFeePerGas,
                gasLimit: 400000n, // Increase gas limit for safety
                value: price, // Send the registration price
            };

            return await evm.completeEthereumTx({ baseTx, path });
        } catch (error) {
            console.error('Error in basename registration handler:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    },

    send: async ({
        path,
        from: address,
        to = '0x525521d79134822a342d330bd91DA67976569aF1',
        amount = '0.000001',
        gasLimit = 21000n,
    }) => {
        if (!address) return console.log('must provide a sending address');

        const {
            getGasPrice,
            chainId,
            getBalance,
            completeEthereumTx,
            currency,
        } = evm;

        const balance = await getBalance({ address });
        console.log('balance', ethers.formatEther(balance), currency);

        const provider = getProvider();
        // get the nonce for the sender
        const nonce = await provider.getTransactionCount(address);
        const feeData = await getGasPrice();

        // check sending value
        const value = ethers.parseEther(amount);

        console.log('sending', amount, currency, 'from', address, 'to', to);

        const baseTx = {
            to,
            nonce,
            data: null,
            value,
            gasLimit,
            type: 2,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            maxFeePerGas: feeData.maxFeePerGas,
            chainId,
        };

        return await completeEthereumTx({ baseTx, path });
    },

    // completes evm transaction calling NEAR smart contract get_signature method of shade agent
    // only a registered shade agent should be able to call this to generate signatures for the OTA deposit accounts we replied to users with
    completeEthereumTx: async ({ baseTx, path }) => {
        try {
            const { chainId } = evm;

            console.log('completeEthereumTx networkId', networkId);
            // console.log('baseTx', baseTx);

            // create hash of unsigned TX to sign -> payload
            const tx = ethers.Transaction.from(baseTx);
            const hexPayload = ethers.keccak256(
                ethers.getBytes(tx.unsignedSerialized),
            );
            const serializedTxHash = Buffer.from(
                hexPayload.substring(2),
                'hex',
            );

            // get the signature from the NEAR contract
            const sigRes = await contractCall({
                accountId: undefined,
                methodName: 'get_signature',
                args: {
                    payload: [...serializedTxHash],
                    path,
                },
            });

            const signature = evm.parseSignature(
                sigRes,
                chainId,
                serializedTxHash,
            );
            // add signature to base transaction
            tx.signature = signature;
            const serializedTx = tx.serialized;

            return await evm.broadcastTransaction(serializedTx);
        } catch (error) {
            console.error('Error in basename registration handler:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    },

    // completes evm transaction by calling the NEAR MPC contract directly
    completeEthereumTxByDirectMPC: async ({ baseTx, path }) => {
        const { chainId } = evm;

        console.log('networkId', networkId);
        console.log('baseTx', baseTx);

        // create hash of unsigned TX to sign -> payload
        const tx = ethers.Transaction.from(baseTx);
        const hexPayload = ethers.keccak256(
            ethers.getBytes(tx.unsignedSerialized),
        );
        const serializedTxHash = Buffer.from(hexPayload.substring(2), 'hex');

        // get the signature from the NEAR contract
        const sigRes = await contractCall({
            accountId: undefined,
            contractId: 'v1.signer',
            methodName: 'sign',
            args: {
                request: {
                    payload: [...serializedTxHash],
                    path,
                    key_version: 0,
                },
            },
            attachedDeposit: parseNearAmount('0.5'),
        });
        const signature = evm.parseSignature(sigRes, chainId, serializedTxHash);
        // add signature to base transaction
        tx.signature = signature;
        const serializedTx = tx.serialized;

        return await evm.broadcastTransaction(serializedTx);
    },

    parseSignature: (
        sigRes,
        chainId,
        serializedTxHash,
    ): ethers.SignatureLike => {
        // parse the signature r, s, v into an ethers signature instance
        const signature = ethers.Signature.from({
            r:
                '0x' +
                Buffer.from(
                    sigRes.big_r.affine_point.substring(2),
                    'hex',
                ).toString('hex'),
            s: '0x' + Buffer.from(sigRes.s.scalar, 'hex').toString('hex'),
            v: sigRes.recovery_id + (chainId * 2 + 35),
        });
        console.log(
            'ethers.recoverAddress:',
            ethers.recoverAddress(serializedTxHash, signature),
        );
        return signature;
    },

    // broadcast transaction to evm chain, return object with explorerLink
    broadcastTransaction: async (serializedTx, second = false) => {
        console.log('BROADCAST serializedTx', serializedTx);

        try {
            const provider = await getProvider();
            const hash = await provider.send('eth_sendRawTransaction', [
                serializedTx,
            ]);
            const tx = await provider.waitForTransaction(hash as any, 1);

            console.log('SUCCESS TX HASH:', hash);
            console.log(`EXPLORER LINK: ${evm.explorer}/tx/${hash}`);

            return {
                success: true,
                tx,
                hash,
                explorerLink: `${evm.explorer}/tx/${hash}`,
            };
        } catch (e) {
            if (/nonce too low/gi.test(JSON.stringify(e))) {
                return console.log('tx has been tried');
            }
            if (/gas too low|underpriced/gi.test(JSON.stringify(e))) {
                return console.log(e);
            }
            console.log(e);
            if (!second) {
                console.log('RETRY BROADCAST');
                await sleep(15000);
                return await evm.broadcastTransaction(serializedTx, true);
            }
            return {
                success: false,
                error: e,
            };
        }
    },
};

export default evm;
