import { Router, Request, Response } from 'express'
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers'

// Environment
const PROVIDER_URL = process.env.ARB_SEPOLIA_RPC || process.env.PRAGUE_RPC
const RELAYER_PK = process.env.BACKEND_PRIVATE_KEY
const PAYMASTER_ADDRESS = process.env.PAYMASTER_CONTRACT_ADDRESS

const provider = new JsonRpcProvider(PROVIDER_URL)
const relayerWallet = new Wallet(RELAYER_PK!, provider)

// EntryPoint v0.8 address
const ENTRYPOINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'

const router = Router()

/**
 * POST /paymaster/sponsor
 * Sponsor a user operation by providing paymaster data and gas estimates
 * Body: {
 *   userOp: PackedUserOperation,
 *   entryPoint: string
 * }
 */
router.post('/paymaster/sponsor', async (req: Request, res: Response) => {
  try {
    const { userOp, entryPoint } = req.body || {}
    if (!userOp) {
      return res.status(400).send({ ok: false, error: 'missing userOp' })
    }

    if (!PAYMASTER_ADDRESS) {
      return res.status(500).send({ ok: false, error: 'paymaster not configured' })
    }

    // Get gas price data
    const feeData = await provider.getFeeData()
    const basePriorityFee = parseUnits('1', 'gwei')
    const networkMaxFee = feeData.maxFeePerGas || feeData.gasPrice || basePriorityFee * 2n
    const maxPriorityFeePerGas = basePriorityFee
    const maxFeePerGas = networkMaxFee > maxPriorityFeePerGas ? networkMaxFee : maxPriorityFeePerGas * 2n

    // Pack gas fees (maxPriorityFeePerGas << 128 | maxFeePerGas)
    const pack128 = (hi: bigint, lo: bigint) => `0x${((hi << 128n) | lo).toString(16).padStart(64, '0')}`
    const gasFees = pack128(maxPriorityFeePerGas, maxFeePerGas)

    // Estimate gas limits
    const verificationGasLimit = 500000n
    const callGasLimit = 1000000n
    const accountGasLimits = pack128(verificationGasLimit, callGasLimit)
    const preVerificationGas = 120000n

    // Paymaster data (just the paymaster address for simple paymaster)
    const paymasterAndData = PAYMASTER_ADDRESS

    // Return sponsored user operation with gas estimates
    const sponsoredUserOp = {
      ...userOp,
      accountGasLimits,
      preVerificationGas: `0x${preVerificationGas.toString(16)}`,
      gasFees,
      paymasterAndData,
    }

    console.log('[paymaster] Sponsored user operation:', {
      sender: userOp.sender,
      gasFees,
      accountGasLimits,
      paymasterAndData,
    })

    return res.send({
      ok: true,
      ...sponsoredUserOp,
    })
  } catch (e: any) {
    console.error('[paymaster] Error in /paymaster/sponsor', e)
    return res.status(500).send({ ok: false, error: e?.message || 'UNKNOWN' })
  }
})

/**
 * GET /paymaster/info
 * Get paymaster information and balance
 */
router.get('/paymaster/info', async (req: Request, res: Response) => {
  try {
    if (!PAYMASTER_ADDRESS) {
      return res.status(500).send({ ok: false, error: 'paymaster not configured' })
    }

    // Get paymaster balance
    const balance = await provider.getBalance(PAYMASTER_ADDRESS)
    
    return res.send({
      ok: true,
      paymaster: PAYMASTER_ADDRESS,
      balance: balance.toString(),
      entryPoint: ENTRYPOINT_V08,
    })
  } catch (e: any) {
    console.error('[paymaster] Error in /paymaster/info', e)
    return res.status(500).send({ ok: false, error: e?.message || 'UNKNOWN' })
  }
})

export default router
