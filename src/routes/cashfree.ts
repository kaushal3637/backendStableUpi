import { Router, Request, Response } from 'express';
import { config } from '../services/config';
import Joi from 'joi';
import mongoose from 'mongoose';
import { CashfreeService, CashfreeBeneficiary, CashfreeQrCodeRequest } from '../services/cashfreeService';
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
 * POST /api/cashfree/beneficiary/add
 * Add a beneficiary for payouts
 */
router.post('/beneficiary/add', async (req: Request, res: Response) => {
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
    const { error, value } = beneficiarySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const beneficiary: CashfreeBeneficiary = value;

    console.log('Adding beneficiary:', beneficiary.beneId);

    // Connect to database
    await connectDB();

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    // Add beneficiary to Cashfree
    const result = await cashfreeService.addBeneficiary(beneficiary);

    // Handle Cashfree error responses
    if (result.status === "ERROR") {
      return res.status(409).json({
        success: false,
        error: result.message || 'Failed to add beneficiary to Cashfree',
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
          { cashfreeBeneficiaryId: beneficiary.beneId }
        ]
      });

      let customer;
      if (existingCustomer) {
        // Update existing customer
        console.log('🔄 Updating existing customer:', existingCustomer.customerId);
        existingCustomer.cashfreeBeneficiaryId = beneficiary.beneId;
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
          cashfreeBeneficiaryId: beneficiary.beneId,
          qrCodeData: qrCodeData,
          isActive: true,
          isBeneficiaryAdded: true,
          isTestMode: true
        });

        customer = await customer.save();
      }

      console.log('✅ Beneficiary stored in database:', customer.customerId);

      // Return success response with both Cashfree and database data
      res.status(200).json({
        success: true,
        data: {
          cashfree: result.data,
          database: {
            customerId: customer.customerId,
            name: customer.name,
            upiId: customer.upiId,
            cashfreeBeneficiaryId: customer.cashfreeBeneficiaryId,
            isBeneficiaryAdded: customer.isBeneficiaryAdded
          }
        },
        message: 'Beneficiary added successfully to both Cashfree and local database'
      } as APIResponse);

    } catch (dbError: any) {
      console.error('❌ Database storage error:', dbError);

      // Beneficiary was created in Cashfree but failed to store locally
      res.status(207).json({ // 207 Multi-Status
        success: true,
        warning: 'Beneficiary created in Cashfree but failed to store locally',
        data: {
          cashfree: result.data,
          database: null
        },
        error: dbError.message,
        message: 'Partial success: Beneficiary created in Cashfree'
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
 * GET /api/cashfree/beneficiary/:beneId
 * Get beneficiary details
 */
router.get('/beneficiary/:beneId', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== config.apiKey) {
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

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    // Get beneficiary details
    const result = await cashfreeService.getBeneficiary(beneId);

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
 * POST /api/cashfree/qr/generate
 * Generate QR code for beneficiary
 */
router.post('/qr/generate', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== config.apiKey) {
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

    const validatedQrRequest: CashfreeQrCodeRequest = value;

    console.log('Generating QR code for beneficiary:', beneficiaryId);

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    // Generate QR code
    const result = await cashfreeService.generateQrCode(beneficiaryId, validatedQrRequest);

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
 * GET /api/cashfree/qr/:qrCodeId
 * Get QR code details
 */
router.get('/qr/:qrCodeId', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== config.apiKey) {
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

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    // Get QR code details
    const result = await cashfreeService.getQrCodeDetails(qrCodeId);

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
 * GET /api/cashfree/health
 * Health check for Cashfree service
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Simple health check - in production you'd check Cashfree API connectivity
    res.status(200).json({
      success: true,
      status: 'healthy',
      service: 'Cashfree Payout Service',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Cashfree service health check failed'
    });
  }
});

/**
 * GET /api/cashfree/beneficiaries
 * Get all beneficiaries from database
 */
router.get('/beneficiaries', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== config.apiKey) {
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
        { cashfreeBeneficiaryId: new RegExp(search as string, 'i') }
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
          cashfreeBeneficiaryId: beneficiary.cashfreeBeneficiaryId,
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

export default router;
