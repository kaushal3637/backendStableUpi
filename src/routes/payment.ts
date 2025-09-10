import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { ERC7702Request, APIResponse, EIP7702SponsoredRequest, USDCMetaTransactionRequest, PrepareMetaTransactionRequest } from '../types';
import { PaymentOrchestrator } from '../services/paymentOrchestrator';
import { USDCMetaTransactionService } from '../services/usdcMetaTransactionService';
import { CashfreeService } from '../services/cashfreeService';
import { config } from '../services/config';

const router = Router();

// Validation schema for ERC-7702 request
const userOpSchema = Joi.object({
  sender: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  nonce: Joi.string().required(),
  initCode: Joi.string().required(),
  callData: Joi.string().required(),
  callGasLimit: Joi.string().required(),
  verificationGasLimit: Joi.string().required(),
  preVerificationGas: Joi.string().required(),
  maxFeePerGas: Joi.string().required(),
  maxPriorityFeePerGas: Joi.string().required(),
  paymasterAndData: Joi.string().required(),
  signature: Joi.string().required(),
});

const upiMerchantSchema = Joi.object({
  pa: Joi.string().pattern(/@/).required(),
  pn: Joi.string().optional(),
  am: Joi.string().optional(),
  cu: Joi.string().optional(),
  mc: Joi.string().optional(),
  tr: Joi.string().optional(),
});

// EIP-7702 Authorization schema
const authorizationSchema = Joi.object({
  chainId: Joi.number().required(),
  address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  nonce: Joi.string().required(),
  yParity: Joi.number().valid(0, 1).required(),
  r: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
  s: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
});

// EIP-7702 Call schema
const callSchema = Joi.object({
  to: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  value: Joi.string().default("0"),
  data: Joi.string().pattern(/^0x[a-fA-F0-9]*$/).default("0x"),
});

// EIP-7702 Sponsored Request schema
const sponsoredRequestSchema = Joi.object({
  userAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  calls: Joi.array().items(callSchema).min(1).required(),
  authorization: authorizationSchema.required(),
  upiMerchantDetails: upiMerchantSchema.required(),
  chainId: Joi.number().valid(1, 42161, 11155111, 421614).required(),
});

// USDC Meta Transaction schema
const usdcMetaTransactionSignatureSchema = Joi.object({
  v: Joi.number().valid(27, 28).required(),
  r: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
  s: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
});

const usdcMetaTransactionRequestSchema = Joi.object({
  from: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  to: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  value: Joi.string().required(),
  validAfter: Joi.number().required(),
  validBefore: Joi.number().required(),
  nonce: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
  signature: usdcMetaTransactionSignatureSchema.required(),
  chainId: Joi.number().valid(1, 42161, 11155111, 421614).required(),
});

const prepareMetaTransactionRequestSchema = Joi.object({
  from: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  to: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  value: Joi.string().required(),
  validAfter: Joi.number().optional(),
  validBefore: Joi.number().optional(),
  chainId: Joi.number().valid(1, 42161, 11155111, 421614).required(),
});

// Updated main request schema (supports legacy, sponsored, and meta transactions)
const erc7702RequestSchema = Joi.object({
  userOp: userOpSchema.optional(),
  sponsoredRequest: sponsoredRequestSchema.optional(),
  metaTransactionRequest: usdcMetaTransactionRequestSchema.optional(),
  upiMerchantDetails: upiMerchantSchema.required(),
  chainId: Joi.number().valid(1, 42161, 11155111, 421614).required(),
}).xor('userOp', 'sponsoredRequest', 'metaTransactionRequest'); // Must have exactly one of the three

/**
 * POST /api/payments/prepare-meta-transaction
 * Prepares a USDC meta transaction for signing
 */
router.post('/prepare-meta-transaction', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== config.apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Validate request body
    const { error, value } = prepareMetaTransactionRequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const request: PrepareMetaTransactionRequest = value;

    console.log('Preparing USDC meta transaction:', {
      from: request.from,
      to: request.to,
      value: request.value,
      chainId: request.chainId
    });

    // Create meta transaction service for the specified chain
    const metaTransactionService = new USDCMetaTransactionService(request.chainId);

    // Prepare the meta transaction
    const result = await metaTransactionService.prepareMetaTransaction(request);

    res.status(200).json({
      success: true,
      data: result,
      message: 'Meta transaction prepared successfully'
    } as APIResponse);

  } catch (error) {
    console.error('Meta transaction preparation error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during meta transaction preparation'
    } as APIResponse);
  }
});

/**
 * POST /api/payments/process
 * Processes USDC meta transaction, ERC-7702 UserOp and initiates UPI payment
 */
router.post('/process', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== config.apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Validate request body
    const { error, value } = erc7702RequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const request: ERC7702Request = value;

    if (request.metaTransactionRequest) {
      console.log('Processing USDC meta transaction payment request:', {
        chainId: request.chainId,
        from: request.metaTransactionRequest.from,
        to: request.metaTransactionRequest.to,
        value: request.metaTransactionRequest.value,
        payee: request.upiMerchantDetails.pa
      });
    } else if (request.sponsoredRequest) {
      console.log('Processing EIP-7702 sponsored payment request (deprecated):', {
        chainId: request.chainId,
        userAddress: request.sponsoredRequest.userAddress,
        payee: request.upiMerchantDetails.pa,
        callsCount: request.sponsoredRequest.calls.length
      });
    } else {
      console.log('Processing legacy ERC-7702 payment request (deprecated):', {
        chainId: request.chainId,
        sender: request.userOp?.sender,
        payee: request.upiMerchantDetails.pa
      });
    }

    // Create payment orchestrator for the specified chain
    const orchestrator = new PaymentOrchestrator(request.chainId);

    // Process the payment
    const result = await orchestrator.processPayment(request);

    if (result.success) {
      res.status(200).json({
        success: true,
        data: result,
        message: 'Payment processed successfully'
      } as APIResponse);
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        data: result
      } as APIResponse);
    }

  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during payment processing'
    } as APIResponse);
  }
});

/**
 * GET /api/payments/status/:transactionHash
 * Gets the status of a payment by transaction hash
 */
router.get('/status/:transactionHash', async (req: Request, res: Response) => {
  try {
    const { transactionHash } = req.params;

    if (!transactionHash || !transactionHash.startsWith('0x')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid transaction hash'
      } as APIResponse);
    }

    // For now, we'll use a default chain ID - in production, you'd store this mapping
    const orchestrator = new PaymentOrchestrator(421614); // Default to Arbitrum Sepolia

    const status = await orchestrator.getPaymentStatus(transactionHash);

    res.status(200).json({
      success: true,
      data: {
        transactionHash,
        ...status
      }
    } as APIResponse);

  } catch (error) {
    console.error('Payment status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during status check'
    } as APIResponse);
  }
});

/**
 * GET /api/payments/payout/status/:transferId
 * Gets the status of an INR payout transfer
 */
router.get('/payout/status/:transferId', async (req: Request, res: Response) => {
  try {
    const { transferId } = req.params;

    if (!transferId) {
      return res.status(400).json({
        success: false,
        error: 'Transfer ID is required'
      } as APIResponse);
    }

    console.log('Getting payout status for transfer ID:', transferId);

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    // Get transfer status
    const statusResponse = await cashfreeService.getTransferStatus(transferId);

    // Return response
    return res.status(200).json({
      success: statusResponse.status === 'SUCCESS',
      status: statusResponse.status,
      message: statusResponse.message,
      transferDetails: statusResponse.data,
      requestedAt: new Date().toISOString(),
    } as APIResponse);

  } catch (error) {
    console.error('Payout status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during payout status check'
    } as APIResponse);
  }
});

/**
 * POST /api/payments/process-payout
 * Processes INR payout after successful USDC transaction
 */
router.post('/process-payout', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== config.apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Validate request body
    const { transactionHash, upiMerchantDetails, chainId } = req.body;

    if (!transactionHash || !upiMerchantDetails || !chainId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: transactionHash, upiMerchantDetails, chainId'
      } as APIResponse);
    }

    console.log('Processing INR payout for transaction:', transactionHash);

    // Create payment orchestrator for the specified chain
    const orchestrator = new PaymentOrchestrator(chainId);

    // For now, we'll create a simplified request just for payout processing
    // In the future, this could be enhanced to verify the USDC transaction first
    const payoutRequest: ERC7702Request = {
      upiMerchantDetails,
      chainId,
      // We don't need metaTransactionRequest or userOp since USDC is already processed
    };

    // Process just the payout part
    const result = await orchestrator.processINRPayoutOnly(payoutRequest, transactionHash);

    if (result.success) {
      res.status(200).json({
        success: true,
        data: result,
        message: 'INR payout processed successfully'
      } as APIResponse);
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        data: result
      } as APIResponse);
    }

  } catch (error) {
    console.error('Payout processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during payout processing'
    } as APIResponse);
  }
});

export default router;
