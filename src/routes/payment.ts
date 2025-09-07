import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { ERC7702Request, APIResponse, EIP7702SponsoredRequest } from '../types';
import { PaymentOrchestrator } from '../services/paymentOrchestrator';
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

// Updated main request schema (supports both legacy and sponsored)
const erc7702RequestSchema = Joi.object({
  userOp: userOpSchema.optional(),
  sponsoredRequest: sponsoredRequestSchema.optional(),
  upiMerchantDetails: upiMerchantSchema.required(),
  chainId: Joi.number().valid(1, 42161, 11155111, 421614).required(),
}).xor('userOp', 'sponsoredRequest'); // Must have either userOp OR sponsoredRequest

/**
 * POST /api/payments/process
 * Processes ERC-7702 UserOp and initiates UPI payment
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

    if (request.sponsoredRequest) {
      console.log('Processing EIP-7702 sponsored payment request:', {
        chainId: request.chainId,
        userAddress: request.sponsoredRequest.userAddress,
        payee: request.upiMerchantDetails.pa,
        callsCount: request.sponsoredRequest.calls.length
      });
    } else {
      console.log('Processing legacy ERC-7702 payment request:', {
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

export default router;
