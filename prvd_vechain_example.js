import { Ident, Vault } from "provide-js";
import { Transaction } from "thor-devkit";
import bent from "bent";

// Get the Provide vault wallet for the organization

//load the refresh token from env
var REFRESH_TOKEN = process.env.PRVD_USER_REFRESH_TOKEN;
var ORG_ID = process.env.PRVD_USER_ORG_ID;
var USER_ID = process.env.PRVD_USER_ID;

var access_token_request = {};
access_token_request.organization_id = ORG_ID;
access_token_request.user_id = USER_ID;

//get the access token
const IDENT_PROXY = new Ident(REFRESH_TOKEN);
const ACCESS_TOKEN = await IDENT_PROXY.createToken(access_token_request);

//get the PRVD vault
const VAULT_PROXY = new Vault(ACCESS_TOKEN.accessToken);
const MY_VAULTS = await VAULT_PROXY.fetchVaults();
var MY_VAULT_ID = MY_VAULTS.results[0].id;

//get the key ids ~ no private keys exposed!!
const MY_VAULT_KEY_IDS = await VAULT_PROXY.fetchVaultKeys(MY_VAULT_ID);
var MY_WALLET = MY_VAULT_KEY_IDS.results.filter(vaultkeys => vaultkeys.spec === "secp256k1");

// address & abi outsourced for readability
const { address, abi } = require('./contract.js');

// setup helper functions for http-requests
const get = bent('GET', 'https://node-testnet.vechain.energy', 'json');
const post = bent('POST', 'https://node-testnet.vechain.energy', 'json');
const getSponsorship = bent('POST', 'https://sponsor-testnet.vechain.energy', 'json');

// build the contract call
const Counter = new ethers.Interface(abi);
const clauses = [{
to: address,
value: '0x0',
data: Counter.encodeFunctionData("increment", [])
}];

// fetch status information for the network
const bestBlock = await get('/blocks/best');
const genesisBlock = await get('/blocks/0');

// build the transaction
const transaction = new Transaction({
    chainTag: Number.parseInt(genesisBlock.id.slice(-2), 16),
    blockRef: bestBlock.id.slice(0, 18),
    expiration: 32,
    clauses,
    gas: bestBlock.gasLimit,
    gasPriceCoef: 0,
    dependsOn: null,
    nonce: Date.now(),
    reserved: {
        features: 1
    }
});

  // simulate the transaction
  const tests = await post('/accounts/*', {
    clauses: transaction.body.clauses,
    caller: MY_WALLET[0].address,
    gas: transaction.body.gas
  });

  // check for errors and throw if any
  for (const test of tests) {
    if (test.reverted) {

      const revertReason = test.data.length > 10 ? ethers.AbiCoder.defaultAbiCoder().decode(['string'], `0x${test.data.slice(10)}`) : test.vmError;
      throw new Error(revertReason);
    }
  }

  // get fee delegation signature
  const { signature } = await getSponsorship('/by/90', { origin: MY_WALLET[0].address, raw: `0x${transaction.encode().toString('hex')}` });
  const sponsorSignature = Buffer.from(signature.substr(2), 'hex');

  // sign the transaction
  const signingHash = transaction.signingHash();
  //const originSignature = secp256k1.sign(signingHash, Buffer.from(wallet.privateKey.slice(2), 'hex'));
  const originSignature = await VAULT_PROXY.signMessage(MY_VAULT_ID, MY_WALLET[0].id,signingHash);
  transaction.signature = Buffer.concat([originSignature.signature, sponsorSignature]);

  // submit the transaction
  const rawTransaction = `0x${transaction.encode().toString('hex')}`;
  const { id } = await post('/transactions', { raw: rawTransaction });
  console.log('Submitted with txId', id);