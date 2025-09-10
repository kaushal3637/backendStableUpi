import { Router, Request, Response } from 'express';
import Joi from 'joi';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import { APIResponse } from '../types';

const router = Router();

// Connect to MongoDB (you might want to move this to a separate database utility)
const connectDB = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.DEVELOPMENT_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/stableupi');
    }
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
};

// Validation schemas
const transactionStoreSchema = Joi.object({
  upiId: Joi.string().required(),
  merchantName: Joi.string().optional(),
  totalUsdToPay: Joi.string().required(),
  inrAmount: Joi.string().required(),
  walletAddress: Joi.string().optional(),
  txnHash: Joi.string().optional(),
  chainId: Joi.number().valid(421614, 11155111).required(),
  isSuccess: Joi.boolean().default(false)
});

const transactionUpdateSchema = Joi.object({
  transactionId: Joi.string().required(),
  txnHash: Joi.string().optional(),
  payoutTransferId: Joi.string().optional(),
  payoutStatus: Joi.string().optional(),
  payoutAmount: Joi.number().optional(),
  payoutRemarks: Joi.string().optional(),
  isSuccess: Joi.boolean().optional(),
  walletAddress: Joi.string().optional()
});

/**
 * POST /api/transactions/store
 * Store UPI transaction details
 */
router.post('/store', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Connect to database
    await connectDB();

    // Validate request body
    const { error, value } = transactionStoreSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const transactionData = value;

    // Create new transaction
    const transaction = new Transaction({
      upiId: transactionData.upiId,
      merchantName: transactionData.merchantName,
      totalUsdToPay: transactionData.totalUsdToPay,
      inrAmount: transactionData.inrAmount,
      walletAddress: transactionData.walletAddress,
      txnHash: transactionData.txnHash,
      chainId: transactionData.chainId,
      isSuccess: transactionData.isSuccess,
      scannedAt: new Date()
    });

    const savedTransaction = await transaction.save();

    console.log('Transaction stored successfully:', savedTransaction._id);

    res.status(201).json({
      success: true,
      data: {
        transactionId: savedTransaction._id.toString(),
        upiId: savedTransaction.upiId,
        merchantName: savedTransaction.merchantName,
        totalUsdToPay: savedTransaction.totalUsdToPay,
        inrAmount: savedTransaction.inrAmount,
        chainId: savedTransaction.chainId,
        isSuccess: savedTransaction.isSuccess,
        scannedAt: savedTransaction.scannedAt
      },
      message: 'Transaction stored successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Store transaction error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during transaction storage'
    } as APIResponse);
  }
});

/**
 * PUT /api/transactions/update
 * Update transaction with payment results
 */
router.put('/update', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Connect to database
    await connectDB();

    // Validate request body
    const { error, value } = transactionUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const updateData = value;

    // Find and update transaction
    const transaction = await Transaction.findById(updateData.transactionId);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      } as APIResponse);
    }

    // Update fields if provided
    if (updateData.txnHash !== undefined) transaction.txnHash = updateData.txnHash;
    if (updateData.payoutTransferId !== undefined) transaction.payoutTransferId = updateData.payoutTransferId;
    if (updateData.payoutStatus !== undefined) transaction.payoutStatus = updateData.payoutStatus;
    if (updateData.payoutAmount !== undefined) transaction.payoutAmount = updateData.payoutAmount;
    if (updateData.payoutRemarks !== undefined) transaction.payoutRemarks = updateData.payoutRemarks;
    if (updateData.isSuccess !== undefined) transaction.isSuccess = updateData.isSuccess;
    if (updateData.walletAddress !== undefined) transaction.walletAddress = updateData.walletAddress;

    // Set paid timestamp if transaction is now successful
    if (updateData.isSuccess && !transaction.paidAt) {
      transaction.paidAt = new Date();
    }

    await transaction.save();

    console.log('Transaction updated successfully:', updateData.transactionId);

    res.status(200).json({
      success: true,
      data: {
        transactionId: transaction._id.toString(),
        txnHash: transaction.txnHash,
        payoutTransferId: transaction.payoutTransferId,
        payoutStatus: transaction.payoutStatus,
        isSuccess: transaction.isSuccess,
        paidAt: transaction.paidAt
      },
      message: 'Transaction updated successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Update transaction error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during transaction update'
    } as APIResponse);
  }
});

/**
 * GET /api/transactions/:transactionId
 * Get transaction details
 */
router.get('/:transactionId', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Connect to database
    await connectDB();

    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        error: 'Transaction ID is required'
      } as APIResponse);
    }

    // Find transaction
    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      } as APIResponse);
    }

    res.status(200).json({
      success: true,
      data: {
        transactionId: transaction._id.toString(),
        upiId: transaction.upiId,
        merchantName: transaction.merchantName,
        totalUsdToPay: transaction.totalUsdToPay,
        inrAmount: transaction.inrAmount,
        walletAddress: transaction.walletAddress,
        txnHash: transaction.txnHash,
        payoutTransferId: transaction.payoutTransferId,
        payoutStatus: transaction.payoutStatus,
        payoutAmount: transaction.payoutAmount,
        payoutRemarks: transaction.payoutRemarks,
        chainId: transaction.chainId,
        isSuccess: transaction.isSuccess,
        scannedAt: transaction.scannedAt,
        paidAt: transaction.paidAt,
        payoutInitiatedAt: transaction.payoutInitiatedAt,
        payoutProcessedAt: transaction.payoutProcessedAt
      },
      message: 'Transaction retrieved successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during transaction retrieval'
    } as APIResponse);
  }
});

/**
 * GET /api/transactions
 * Get transactions with pagination and filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Connect to database
    await connectDB();

    const {
      limit = 50,
      offset = 0,
      upiId,
      chainId,
      isSuccess,
      payoutStatus,
      startDate,
      endDate
    } = req.query;

    // Build filter
    const filter: any = {};

    if (upiId) filter.upiId = upiId;
    if (chainId) filter.chainId = parseInt(chainId as string);
    if (isSuccess !== undefined) filter.isSuccess = isSuccess === 'true';
    if (payoutStatus) filter.payoutStatus = payoutStatus;

    // Date range filter
    if (startDate || endDate) {
      filter.scannedAt = {};
      if (startDate) filter.scannedAt.$gte = new Date(startDate as string);
      if (endDate) filter.scannedAt.$lte = new Date(endDate as string);
    }

    const transactions = await Transaction.find(filter)
      .sort({ scannedAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(offset as string));

    const totalCount = await Transaction.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        transactions: transactions.map(tx => ({
          transactionId: tx._id.toString(),
          upiId: tx.upiId,
          merchantName: tx.merchantName,
          totalUsdToPay: tx.totalUsdToPay,
          inrAmount: tx.inrAmount,
          walletAddress: tx.walletAddress,
          txnHash: tx.txnHash,
          payoutTransferId: tx.payoutTransferId,
          payoutStatus: tx.payoutStatus,
          payoutAmount: tx.payoutAmount,
          chainId: tx.chainId,
          isSuccess: tx.isSuccess,
          scannedAt: tx.scannedAt,
          paidAt: tx.paidAt
        })),
        pagination: {
          total: totalCount,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        }
      },
      message: 'Transactions retrieved successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during transactions retrieval'
    } as APIResponse);
  }
});

export default router;
