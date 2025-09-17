import { Router, Request, Response } from 'express'
import { JsonRpcProvider, Wallet, Interface, Signature, toBeHex, parseUnits } from 'ethers'

// Minimal config (reuse env like delegation route)
const PROVIDER_URL = process.env.ARB_SEPOLIA_RPC || process.env.PRAGUE_RPC
const RELAYER_PK = process.env.BACKEND_PRIVATE_KEY

const provider = new JsonRpcProvider(PROVIDER_URL)
const relayerWallet = new Wallet(RELAYER_PK!, provider)

// EntryPoint v0.8 address
const ENTRYPOINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'

// Minimal ABI for EntryPoint v0.8 handleOps
const entryPointIface = new Interface([
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)'
])

const router = Router()

/**
 * POST /aa/send
 * Wraps a provided UserOperation in a type:4 EIP-7702 tx with authorizationList
 * Body: {
 *   authorization: { chainId, accountContract, address, nonce, signature, signer },
 *   userOp: { sender, nonce, initCode, callData, accountGasLimits, preVerificationGas, gasFees, paymasterAndData, signature },
 *   beneficiary?: string
 * }
 */
router.post('/aa/send', async (req: Request, res: Response) => {
  try {
    const { authorization, userOp, beneficiary } = req.body || {}
    if (!authorization || !userOp) {
      return res.status(400).send({ ok: false, error: 'missing authorization or userOp' })
    }
    const { chainId, signature, address, nonce, signer, accountContract } = authorization
    
    console.log('[bundler] Authorization details:', {
      chainId,
      userEOA: address,
      signerEOA: signer,
      accountContract,
      nonce
    })

    // Convert hex strings to BigInt for ethers
    const parseHex = (hex: string) => BigInt(hex || '0x0')
    
    // Prepare handleOps data with proper type conversion
    const ops = [{
      sender: userOp.sender,
      nonce: parseHex(userOp.nonce),
      initCode: userOp.initCode || '0x',
      callData: userOp.callData || '0x',
      accountGasLimits: userOp.accountGasLimits || '0x0000000000000000000000000000000000000000000000000000000000000000',
      preVerificationGas: parseHex(userOp.preVerificationGas),
      gasFees: userOp.gasFees || '0x0000000000000000000000000000000000000000000000000000000000000000',
      paymasterAndData: userOp.paymasterAndData || '0x',
      signature: userOp.signature || '0x',
    }]
    
    console.log('[bundler] Prepared ops:', JSON.stringify(ops, (_, v) => typeof v === 'bigint' ? v.toString() : v))
    const handleOpsData = entryPointIface.encodeFunctionData('handleOps', [ops, beneficiary || relayerWallet.address])
    console.log('[bundler] HandleOps data length:', handleOpsData.length, 'first 100 chars:', handleOpsData.substring(0, 100))

    // AuthorizationList from EIP-712 sig
    const sig = Signature.from(signature)
    const relayerNonce = await provider.getTransactionCount(relayerWallet.address, 'pending')

    // Fees
    const feeData = await provider.getFeeData()
    const basePriorityFee = parseUnits('1', 'gwei')
    const networkMaxFee = feeData.maxFeePerGas || feeData.gasPrice || basePriorityFee * 2n
    const maxPriorityFeePerGas = basePriorityFee
    const maxFeePerGas = networkMaxFee > maxPriorityFeePerGas ? networkMaxFee : maxPriorityFeePerGas * 2n

    // Try without authorizationList first to test if EntryPoint works
    const tx = {
      type: 2, // Use EIP-1559 instead of type 4 for now
      chainId: BigInt(chainId),
      nonce: BigInt(relayerNonce),
      to: ENTRYPOINT_V08,
      value: 0n,
      data: handleOpsData,
      gasLimit: 1_500_000n,
      maxFeePerGas,
      maxPriorityFeePerGas,
      // authorizationList: [{
      //   chainId: toBeHex(chainId),
      //   address: accountContract, // Smart account implementation to delegate to
      //   nonce: toBeHex(nonce),
      //   yParity: sig.yParity ? '0x1' : '0x0',
      //   r: sig.r,
      //   s: sig.s,
      // }]
    } as any

    console.log('[bundler] Final transaction:', {
      to: tx.to,
      data: tx.data ? tx.data.substring(0, 100) + '...' : 'EMPTY',
      dataLength: tx.data?.length || 0,
      authListLength: tx.authorizationList?.length || 0
    })

    const signed = await relayerWallet.signTransaction(tx)
    console.log('[bundler] Signed transaction length:', signed.length)
    
    const sent = await provider.broadcastTransaction(signed)
    console.log('[bundler] Broadcast successful, hash:', sent.hash)
    
    const rcpt = await sent.wait()
    console.log('[bundler] Receipt status:', rcpt?.status)
    return res.send({ ok: true, txHash: rcpt?.hash })
  } catch (e: any) {
    console.error('[bundler] Error in /aa/send', e)
    return res.status(500).send({ ok: false, error: e?.message || 'UNKNOWN' })
  }
})

export default router


