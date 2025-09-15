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

// Validation schemas
const beneficiarySchema = Joi.object({
  beneId: Joi.string().required(),
  name: Joi.string().required(),
  email: Joi.string().email().optional(),
  phone: Joi.string().optional(),
  vpa: Joi.string().optional(),
  bankAccount: Joi.object({
    accountNumber: Joi.string().required(),
    ifsc: Joi.string().required(),
    accountHolderName: Joi.string().required()
  }).optional(),
  address1: Joi.string().optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  pincode: Joi.string().optional()
});

const qrCodeRequestSchema = Joi.object({
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

    const beneficiary: PhonePeBeneficiary = value;

    console.log('Adding beneficiary:', beneficiary.beneId);

    // Connect to database
    await connectDB();

    // Initialize PhonePe service
    const phonepeService = new PhonePeService();

    // Add beneficiary to PhonePe
    const result = await phonepeService.addBeneficiary(beneficiary);

    // Handle PhonePe error responses
    if (result.status === "ERROR") {
      return res.status(409).json({
        success: false,
        error: result.message || 'Failed to add beneficiary to PhonePe',
        data: result.data
      } as APIResponse);
    }

    try {
      // Store beneficiary data in local database
      console.log('📝 Storing beneficiary in database...');

      // Check if customer already exists
      const existingCustomer = await Customer.findOne({
        $or: [
          { customerId: beneficiary.beneId },
          { upiId: beneficiary.vpa },
          { phonepebeneficiaryId: beneficiary.beneId }
        ]
      });

      let customer;
      if (existingCustomer) {
        // Update existing customer
        console.log('🔄 Updating existing customer:', existingCustomer.customerId);
        existingCustomer.phonepebeneficiaryId = beneficiary.beneId;
        existingCustomer.isBeneficiaryAdded = true;
        existingCustomer.upiId = beneficiary.vpa || existingCustomer.upiId;
        existingCustomer.name = beneficiary.name;
        if (beneficiary.email) existingCustomer.email = beneficiary.email;
        if (beneficiary.phone) existingCustomer.phone = beneficiary.phone;
        existingCustomer.updatedAt = new Date();
        customer = await existingCustomer.save();
      } else {
        // Create new customer record
        console.log('🆕 Creating new customer record');
        const qrCodeData = beneficiary.vpa ? `upi://pay?pa=${encodeURIComponent(beneficiary.vpa)}&pn=${encodeURIComponent(beneficiary.name)}&cu=INR` : '';

        customer = new Customer({
          customerId: beneficiary.beneId,
          name: beneficiary.name,
          email: beneficiary.email || `bene_${beneficiary.beneId}@example.com`,
          phone: beneficiary.phone || '',
          upiId: beneficiary.vpa || '',
          upiName: beneficiary.name,
          phonepebeneficiaryId: beneficiary.beneId,
          qrCodeData: qrCodeData,
          isActive: true,
          isBeneficiaryAdded: true,
          isTestMode: true
        });

        customer = await customer.save();
      }

      console.log('✅ Beneficiary stored in database:', customer.customerId);

      // Return success response with both PhonePe and database data
      res.status(200).json({
        success: true,
        data: {
          phonepe: result.data,
          database: {
            customerId: customer.customerId,
            name: customer.name,
            upiId: customer.upiId,
            phonepebeneficiaryId: customer.phonepebeneficiaryId,
            isBeneficiaryAdded: customer.isBeneficiaryAdded
          }
        },
        message: 'Beneficiary added successfully to both PhonePe and local database'
      } as APIResponse);

    } catch (dbError: any) {
      console.error('❌ Database storage error:', dbError);

      // Beneficiary was created in PhonePe but failed to store locally
      res.status(207).json({ // 207 Multi-Status
        success: true,
        warning: 'Beneficiary created in PhonePe but failed to store locally',
        data: {
          phonepe: result.data,
          database: null
        },
        error: dbError.message,
        message: 'Partial success: Beneficiary created in PhonePe'
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
 * GET /api/phonepe/beneficiary/:beneId
 * Get beneficiary details
 */
router.get('/beneficiary/:beneId', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    const { beneId } = req.params;

    if (!beneId) {
      return res.status(400).json({
        success: false,
        error: 'Beneficiary ID is required'
      } as APIResponse);
    }

    console.log('Getting beneficiary details:', beneId);

    // Initialize PhonePe service
    const phonepeService = new PhonePeService();

    // Get beneficiary details
    const result = await phonepeService.getBeneficiary(beneId);

    res.status(200).json({
      success: true,
      data: result,
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
 * Generate QR code for beneficiary
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

    const { beneficiaryId, ...qrRequest } = req.body;

    if (!beneficiaryId) {
      return res.status(400).json({
        success: false,
        error: 'Beneficiary ID is required'
      } as APIResponse);
    }

    // Validate QR request
    const { error, value } = qrCodeRequestSchema.validate(qrRequest);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const validatedQrRequest: PhonePeQrCodeRequest = value;

    console.log('Generating QR code for beneficiary:', beneficiaryId);

    // Initialize PhonePe service
    const phonepeService = new PhonePeService();

    // Generate QR code
    const result = await phonepeService.generateQrCode(beneficiaryId, validatedQrRequest);

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
    const filter: any = { isBeneficiaryAdded: true };
    if (search) {
      filter.$or = [
        { name: new RegExp(search as string, 'i') },
        { upiId: new RegExp(search as string, 'i') },
        { customerId: new RegExp(search as string, 'i') },
        { phonepebeneficiaryId: new RegExp(search as string, 'i') }
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
          customerId: beneficiary.customerId,
          name: beneficiary.name,
          email: beneficiary.email,
          upiId: beneficiary.upiId,
          phonepebeneficiaryId: beneficiary.phonepebeneficiaryId,
          isBeneficiaryAdded: beneficiary.isBeneficiaryAdded,
          qrCodeData: beneficiary.qrCodeData,
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
