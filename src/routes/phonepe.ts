import { Router, Request, Response } from 'express';
import Joi from 'joi';
import mongoose from 'mongoose';
import { PhonePeService, PhonePeBeneficiary, PhonePeQrCodeRequest } from '../services/phonepeService';
import { APIResponse } from '../types';
import Customer from '../models/Customer';

const router = Router();

// Connect to MongoDB (you might want to move this to a separate database utility)
const connectDB = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.DEVELOPMENT_MONGODB_URI || 'mongodb://localhost:27017/stableupi');
    }
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
};

// Validation schemas - simplified to only name and vpa
const beneficiarySchema = Joi.object({
  name: Joi.string().required().trim(),
  vpa: Joi.string().required().trim().pattern(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'UPI ID format')
});

const qrCodeRequestSchema = Joi.object({
  vpa: Joi.string().required().trim().pattern(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'UPI ID format'),
  amount: Joi.number().positive().optional(),
  purpose: Joi.string().optional(),
  remarks: Joi.string().optional(),
  expiryDate: Joi.string().optional()
});

/**
 * POST /api/phonepe/beneficiary/add
 * Add a beneficiary for payouts
 */
router.post('/beneficiary/add', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Validate request body
    const { error, value } = beneficiarySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const { name, vpa } = value;

    console.log('Adding beneficiary:', vpa);

    // Connect to database
    await connectDB();

    try {
      // Check if beneficiary already exists by VPA
      const existingCustomer = await Customer.findByVpa(vpa);

      let customer;
      if (existingCustomer) {
        // Update existing customer
        console.log('🔄 Updating existing customer:', existingCustomer._id);
        existingCustomer.name = name;
        existingCustomer.updatedAt = new Date();
        customer = await existingCustomer.save();
      } else {
        // Create new customer record
        console.log('🆕 Creating new customer record');

        customer = new Customer({
          name: name,
          vpa: vpa,
          isActive: true,
          isTestMode: true
        });

        customer = await customer.save();
      }

      console.log('✅ Beneficiary stored in database:', customer._id);

      // Return success response with database data
      res.status(200).json({
        success: true,
        data: {
          database: {
            beneficiaryId: customer._id.toString(),
            name: customer.name,
            vpa: customer.vpa,
            isActive: customer.isActive
          }
        },
        message: 'Beneficiary added successfully to database'
      } as APIResponse);

    } catch (dbError: any) {
      console.error('❌ Database storage error:', dbError);

      res.status(500).json({
        success: false,
        error: dbError.message || 'Failed to store beneficiary in database'
      } as APIResponse);
    }                                                            
    

  } catch (error: any) {
    console.error('Add beneficiary error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during beneficiary creation'
    } as APIResponse);
  }
});

/**
 * GET /api/phonepe/beneficiary/vpa/:vpa
 * Get beneficiary details by VPA
 */
router.get('/beneficiary/vpa/:vpa', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    const { vpa } = req.params;

    if (!vpa) {
      return res.status(400).json({
        success: false,
        error: 'VPA is required'
      } as APIResponse);
    }

    console.log('Getting beneficiary details by VPA:', vpa);

    // Connect to database
    await connectDB();

    // Find beneficiary by VPA
    const customer = await Customer.findByVpa(vpa);

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Beneficiary not found'
      } as APIResponse);
    }

    res.status(200).json({
      success: true,
      data: {
        beneficiaryId: customer._id.toString(),
        name: customer.name,
        vpa: customer.vpa,
        isActive: customer.isActive,
        totalReceived: customer.totalReceived,
        totalPaid: customer.totalPaid,
        transactionCount: customer.transactionCount,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt
      },
      message: 'Beneficiary details retrieved successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Get beneficiary error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during beneficiary retrieval'
    } as APIResponse);
  }
});

/**
 * POST /api/phonepe/qr/generate
 * Generate QR code for UPI ID
 */
router.post('/qr/generate', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    // Validate QR request (now includes vpa as required field)
    const { error, value } = qrCodeRequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const { vpa, ...qrRequest } = value;

    console.log('Generating QR code for UPI ID:', vpa);

    // Connect to database to check if beneficiary exists
    await connectDB();
    
    // Find or create beneficiary by VPA
    let customer = await Customer.findByVpa(vpa);
    
    if (!customer) {
      // Create a basic beneficiary record if it doesn't exist
      console.log('🆕 Creating basic beneficiary record for QR generation');
      customer = new Customer({
        name: 'Merchant', // Default name for QR-only beneficiaries
        vpa: vpa,
        isActive: true,
        isTestMode: true
      });
      customer = await customer.save();
    }

    // Initialize PhonePe service
    const phonepeService = new PhonePeService();

    // Generate QR code using the customer ID and VPA
    const result = await phonepeService.generateQrCode(customer._id.toString(), {
      ...qrRequest,
      vpa: vpa
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'QR code generated successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Generate QR code error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during QR code generation'
    } as APIResponse);
  }
});

/**
 * GET /api/phonepe/qr/:qrCodeId
 * Get QR code details
 */
router.get('/qr/:qrCodeId', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    const { qrCodeId } = req.params;

    if (!qrCodeId) {
      return res.status(400).json({
        success: false,
        error: 'QR code ID is required'
      } as APIResponse);
    }

    console.log('Getting QR code details:', qrCodeId);

    // Initialize PhonePe service
    const phonepeService = new PhonePeService();

    // Get QR code details
    const result = await phonepeService.getQrCodeDetails(qrCodeId);

    res.status(200).json({
      success: true,
      data: result,
      message: 'QR code details retrieved successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Get QR code details error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during QR code retrieval'
    } as APIResponse);
  }
});

/**
 * GET /api/phonepe/health
 * Health check for PhonePe service
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Initialize PhonePe service
    const phonepeService = new PhonePeService();
    
    // Perform health check
    const healthResult = await phonepeService.healthCheck();
    
    res.status(200).json({
      success: true,
      status: healthResult.status,
      service: 'PhonePe Payout Service',
      message: healthResult.message,
      timestamp: healthResult.timestamp,
      environment: process.env.NODE_ENV
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'PhonePe service health check failed'
    });
  }
});

/**
 * GET /api/phonepe/beneficiaries
 * Get all beneficiaries from database
 */
router.get('/beneficiaries', async (req: Request, res: Response) => {
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

    const { limit = 50, offset = 0, search } = req.query;

    // Build search filter
    const filter: any = { isActive: true };
    if (search) {
      filter.$or = [
        { name: new RegExp(search as string, 'i') },
        { vpa: new RegExp(search as string, 'i') }
      ];
    }

    const beneficiaries = await Customer.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(offset as string));

    const totalCount = await Customer.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        beneficiaries: beneficiaries.map(beneficiary => ({
          beneficiaryId: beneficiary._id.toString(),
          name: beneficiary.name,
          vpa: beneficiary.vpa,
          isActive: beneficiary.isActive,
          totalReceived: beneficiary.totalReceived,
          totalPaid: beneficiary.totalPaid,
          transactionCount: beneficiary.transactionCount,
          createdAt: beneficiary.createdAt,
          updatedAt: beneficiary.updatedAt
        })),
        pagination: {
          total: totalCount,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        }
      },
      message: 'Beneficiaries retrieved successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Get beneficiaries error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during beneficiaries retrieval'
    } as APIResponse);
  }
});

/**
 * GET /api/phonepe/status/:transactionId
 * Check payment/payout status using PhonePe Status API
 */
router.get('/status/:transactionId', async (req: Request, res: Response) => {
  try {
    console.log('📊 Status check request received');
    
    const { transactionId } = req.params;
    
    if (!transactionId) {
      return res.status(400).json({
        success: false,
        error: 'Transaction ID is required'
      } as APIResponse);
    }

    console.log(`🔍 Checking status for transaction: ${transactionId}`);

    const phonepeService = new PhonePeService();
    const statusResult = await phonepeService.checkPaymentStatus(transactionId);

    console.log('✅ Status check completed:', statusResult.code);

    res.json({
      success: statusResult.success,
      message: statusResult.message,
      data: statusResult,
    } as APIResponse);

  } catch (error: any) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during status check'
    } as APIResponse);
  }
});

export default router;
