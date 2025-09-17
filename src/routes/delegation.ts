import { Router, Request, Response } from 'express'
import {
  JsonRpcProvider, Wallet, Interface, verifyTypedData, Signature, toBeHex, parseUnits
} from 'ethers'

// Environment
const PROVIDER_URL = process.env.ARB_SEPOLIA_RPC || process.env.PRAGUE_RPC
const RELAYER_PK = process.env.BACKEND_PRIVATE_KEY

// Basic guard
if (!PROVIDER_URL) {
  // eslint-disable-next-line no-console
  console.warn('[delegation] PROVIDER_URL is not set (ARB_SEPOLIA_RPC or PRAGUE_RPC)')
}
if (!RELAYER_PK) {
  // eslint-disable-next-line no-console
  console.warn('[delegation] RELAYER_PRIVATE_KEY is not set')
}

const provider = new JsonRpcProvider(PROVIDER_URL)
const relayerWallet = new Wallet(RELAYER_PK!, provider);

const router = Router()

// EIP-7702 delegation (Prague RPC required)
router.post('/delegate', async (req: Request, res: Response) => {
    try {
      const { authorization, transaction } = req.body;
      if (!authorization || !transaction) return res.status(400).send({ error: 'missing authorization or transaction' });
  
      const { chainId, address, nonce, signature, signer } = authorization;
      const { to, data, value, gasLimit, gasPrice } = transaction;
  
      // Verify EIP-712 auth (Sepolia domain)
      const domain = { name: 'arbitrum-sepolia', version: '1', chainId, verifyingContract: address };
      const types = { Authorization: [
        { name: 'chainId', type: 'uint64' },
        { name: 'address', type: 'address' },
        { name: 'nonce', type: 'uint64' }
      ]};
      const recovered = verifyTypedData(domain, types, { chainId, address: signer, nonce }, signature);
      if (recovered.toLowerCase() !== signer.toLowerCase()) {
        return res.status(400).send({ error: 'invalid authorization signature' });
      }
  
      // Build type-4 tx with authorizationList
      const sig = Signature.from(signature);
      const relayerNonce = await provider.getTransactionCount(relayerWallet.address, 'pending');
      
      // Get proper gas fees from network
      const feeData = await provider.getFeeData();
      const basePriorityFee = parseUnits('1', 'gwei');
      const networkMaxFee = feeData.maxFeePerGas || feeData.gasPrice || basePriorityFee * 2n;
      
      // Ensure maxFeePerGas >= maxPriorityFeePerGas
      const maxPriorityFeePerGas = basePriorityFee;
      const maxFeePerGas = networkMaxFee > maxPriorityFeePerGas ? networkMaxFee : maxPriorityFeePerGas * 2n;
      
      console.log('Gas fees:', { maxPriorityFeePerGas: maxPriorityFeePerGas.toString(), maxFeePerGas: maxFeePerGas.toString() });
      
      const eip7702Tx = {
        type: 4,
        chainId: BigInt(chainId),
        nonce: BigInt(relayerNonce),
        to: to,
        value: BigInt(value ?? 0),
        data: data,
        gasLimit: BigInt(gasLimit),
        maxFeePerGas,
        maxPriorityFeePerGas,
        authorizationList: [{
          chainId: toBeHex(chainId),
          address: signer,
          nonce: toBeHex(nonce),
          yParity: sig.yParity ? '0x1' : '0x0',
          r: sig.r,
          s: sig.s
        }]
      };
  
      const signed = await relayerWallet.signTransaction(eip7702Tx as any);
      const tx = await provider.broadcastTransaction(signed);
      const rcpt = await tx.wait();
      res.send({ ok: true, type: 'eip-7702-delegation', txHash: rcpt?.hash, transactionId: rcpt?.hash });
    } catch (e) {
      res.status(500).send({ error: e instanceof Error ? e.message : 'UNKNOWN', code: e instanceof Error ? e.message : 'UNKNOWN' });
    }
  });
  
// router.post('/delegate', async (req: Request, res: Response) => {
//   try {
//     const { authorization, transaction } = req.body || {}
//     if (!authorization || !transaction) {
//       console.warn('[delegation] Missing authorization or transaction in request body', { body: req.body })
//       return res.status(400).send({ error: 'missing authorization or transaction' })
//     }

//     if (!relayerWallet) {
//       console.error('[delegation] Relayer wallet not initialized')
//       return res.status(500).send({ error: 'relayer not initialized' })
//     }

//     const { chainId, address, nonce, signature, signer } = authorization
//     const { to, data, value, gasLimit } = transaction

//     console.log('[delegation] Received /delegate request', {
//       chainId,
//       address,
//       nonce,
//       signer,
//       to,
//       value,
//       gasLimit,
//       relayer: relayerWallet.address
//     })

//     // Verify EIP-712 auth
//     const domain = { name: 'arbitrum-sepolia', version: '1', chainId, verifyingContract: address }
//     const types = { Authorization: [
//       { name: 'chainId', type: 'uint64' },
//       { name: 'address', type: 'address' },
//       { name: 'nonce', type: 'uint64' }
//     ]}
//     let recovered: string
//     try {
//       recovered = verifyTypedData(domain, types as any, { chainId, address, nonce }, signature)
//     } catch (err) {
//       console.error('[delegation] Error verifying EIP-712 signature', { error: err, domain, types, authorization })
//       return res.status(400).send({ error: 'invalid authorization signature (malformed)' })
//     }
//     if (recovered.toLowerCase() !== String(signer).toLowerCase()) {
//       console.warn('[delegation] Invalid authorization signature', { recovered, expected: signer })
//       return res.status(400).send({ error: 'invalid authorization signature' })
//     }

//     const sig = Signature.from(signature)
//     const relayerNonce = await provider.getTransactionCount(relayerWallet.address, 'pending')

//     // Gas fees
//     const feeData = await provider.getFeeData()
//     const basePriorityFee = parseUnits('1', 'gwei')
//     const networkMaxFee = feeData.maxFeePerGas || feeData.gasPrice || basePriorityFee * 2n
//     const maxPriorityFeePerGas = basePriorityFee
//     const maxFeePerGas = networkMaxFee > maxPriorityFeePerGas ? networkMaxFee : maxPriorityFeePerGas * 2n

//     const eip7702Tx: any = {
//       type: 4,
//       chainId: BigInt(chainId),
//       nonce: BigInt(relayerNonce),
//       to,
//       value: BigInt(value ?? 0),
//       data,
//       gasLimit: BigInt(gasLimit),
//       maxFeePerGas,
//       maxPriorityFeePerGas,
//       authorizationList: [{
//         chainId: toBeHex(chainId),
//         address,
//         nonce: toBeHex(nonce),
//         yParity: sig.yParity ? '0x1' : '0x0',
//         r: sig.r,
//         s: sig.s
//       }]
//     }

//     console.log('[delegation] Prepared EIP-7702 tx', {
//       ...eip7702Tx,
//       maxFeePerGas: maxFeePerGas.toString(),
//       maxPriorityFeePerGas: maxPriorityFeePerGas.toString()
//     })

//     const signed = await relayerWallet.signTransaction(eip7702Tx)
//     console.log('[delegation] Signed transaction', { signed })

//     const tx = await provider.broadcastTransaction(signed)
//     console.log('[delegation] Broadcasted transaction', { hash: tx.hash })

//     const rcpt = await tx.wait()
//     console.log('[delegation] Transaction confirmed', { hash: rcpt?.hash, status: rcpt?.status })

//     return res.send({ ok: true, type: 'eip-7702-delegation', txHash: rcpt?.hash, transactionId: rcpt?.hash })
//   } catch (e: any) {
//     console.error('[delegation] Error in /delegate', { error: e, stack: e?.stack })
//     return res.status(500).send({ error: e?.message || 'UNKNOWN', code: e?.code || 'UNKNOWN' })
//   }
// })

/**
 * POST /estimate
 * Computes gas (best-effort) and returns buffered fee in USDC-equivalent if FIXED_ETH_USD set
 */
router.post('/estimate', async (req: Request, res: Response) => {
  try {
    const { authorization, intent } = req.body || {}
    if (!authorization || !intent) {
      console.warn('[delegation] Missing authorization or intent in /estimate', { body: req.body })
      return res.status(400).send({ error: 'missing authorization or intent' })
    }

    const { chainId } = authorization
    const { token, to, amount } = intent

    console.log('[delegation] Received /estimate request', {
      chainId,
      token,
      to,
      amount,
      relayer: relayerWallet?.address
    })

    const erc20 = new Interface(['function transfer(address,uint256)'])
    const transferData = erc20.encodeFunctionData('transfer', [to, amount])

    let gasEstimate: bigint
    try {
      const relayerNonce = relayerWallet ? await provider.getTransactionCount(relayerWallet.address, 'pending') : 0
      const feeData = await provider.getFeeData()
      const priority = parseUnits('1', 'gwei')
      const baseMax = feeData.maxFeePerGas || feeData.gasPrice || priority * 2n
      const maxFee = baseMax >= priority ? baseMax : priority * 2n
      const estTx: any = {
        type: 4,
        chainId: BigInt(chainId),
        nonce: BigInt(relayerNonce),
        to: token,
        value: 0n,
        data: transferData,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priority,
        authorizationList: []
      }
      gasEstimate = await provider.estimateGas(estTx)
      console.log('[delegation] Gas estimate (EIP-7702)', { gasEstimate: gasEstimate.toString() })
    } catch (err) {
      const from = relayerWallet?.address
      gasEstimate = await provider.estimateGas({ from, to: token, data: transferData })
      gasEstimate = gasEstimate + 30000n
      console.warn('[delegation] Fallback gas estimate (legacy tx)', { gasEstimate: gasEstimate.toString(), error: err })
    }

    const fee = await provider.getFeeData()
    const priority = parseUnits('1', 'gwei')
    const baseMax = fee.maxFeePerGas || fee.gasPrice || priority * 2n
    const maxFee = baseMax >= priority ? baseMax : priority * 2n
    const block = await provider.getBlock('latest')
    const baseFee = block?.baseFeePerGas ?? maxFee
    const effectiveGasPrice = (baseFee + priority) < maxFee ? (baseFee + priority) : maxFee
    const gasCostWei = gasEstimate * effectiveGasPrice

    console.log('[delegation] Gas/fee calculation', {
      gasEstimate: gasEstimate.toString(),
      effectiveGasPrice: effectiveGasPrice.toString(),
      gasCostWei: gasCostWei.toString()
    })

    const FIXED_ETH_USD = process.env.FIXED_ETH_USD ? Number(process.env.FIXED_ETH_USD) : undefined
    if (!FIXED_ETH_USD) {
      return res.send({ ok: true, gasEstimate: gasEstimate.toString(), effectiveGasPrice: effectiveGasPrice.toString(), gasCostWei: gasCostWei.toString() })
    }
    const ethUsd = BigInt(Math.floor(Number(FIXED_ETH_USD) * 1e8))
    const numerator = gasCostWei * ethUsd
    const denom = 10n ** 20n
    const feeUsdc = (numerator + denom - 1n) / denom
    const feeUsdcBuffered = (feeUsdc * 105n) / 100n
    const inputAmount = BigInt(amount)
    const transferAmount = inputAmount + feeUsdcBuffered

    console.log('[delegation] USDC fee calculation', {
      ethUsd: ethUsd.toString(),
      feeUsdc: feeUsdc.toString(),
      feeUsdcBuffered: feeUsdcBuffered.toString(),
      transferAmount: transferAmount.toString()
    })

    return res.send({
      ok: true,
      gasEstimate: gasEstimate.toString(),
      effectiveGasPrice: effectiveGasPrice.toString(),
      gasCostWei: gasCostWei.toString(),
      feeUSDC: feeUsdcBuffered.toString(),
      transferAmount: transferAmount.toString()
    })
  } catch (e: any) {
    console.error('[delegation] Error in /estimate', { error: e, stack: e?.stack })
    return res.status(500).send({ error: e?.message || 'UNKNOWN', code: e?.code || 'UNKNOWN' })
  }
})

export default router
