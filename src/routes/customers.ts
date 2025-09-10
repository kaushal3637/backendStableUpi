import { Router, Request, Response } from 'express';
import Joi from 'joi';
import mongoose from 'mongoose';
import Customer from '../models/Customer';
import { CashfreeService } from '../services/cashfreeService';
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
const customerCreateSchema = Joi.object({
  name: Joi.string().required().trim(),
  email: Joi.string().email().required().trim(),
  phone: Joi.string().optional().trim(),
  upiId: Joi.string().required().trim(),
  upiName: Joi.string().optional().trim(),
  isTestMode: Joi.boolean().default(true)
});

/**
 * POST /api/customers/create
 * Create a new customer
 */
router.post('/create', async (req: Request, res: Response) => {
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
    const { error, value } = customerCreateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const customerData = value;

    // Check if customer with this UPI ID or email already exists
    const existingCustomer = await Customer.findOne({
      $or: [
        { upiId: customerData.upiId },
        { email: customerData.email }
      ]
    });

    if (existingCustomer) {
      return res.status(409).json({
        success: false,
        error: 'Customer with this UPI ID or email already exists',
        data: {
          customerId: existingCustomer.customerId,
          upiId: existingCustomer.upiId,
          email: existingCustomer.email
        }
      } as APIResponse);
    }

    // Generate unique customer ID
    const customerId = Customer.generateCustomerId();

    // Generate UPI QR code data
    const qrCodeData = `upi://pay?pa=${encodeURIComponent(customerData.upiId)}&pn=${encodeURIComponent(customerData.upiName || customerData.name)}&cu=INR`;

    // Create new customer
    const customer = new Customer({
      customerId,
      name: customerData.name,
      email: customerData.email,
      phone: customerData.phone,
      upiId: customerData.upiId,
      upiName: customerData.upiName,
      qrCodeData,
      isTestMode: customerData.isTestMode,
      isActive: true,
      isBeneficiaryAdded: false
    });

    const savedCustomer = await customer.save();

    console.log('Customer created successfully:', customerId);

    res.status(201).json({
      success: true,
      data: {
        customerId: savedCustomer.customerId,
        name: savedCustomer.name,
        email: savedCustomer.email,
        upiId: savedCustomer.upiId,
        qrCodeData: savedCustomer.qrCodeData,
        isTestMode: savedCustomer.isTestMode,
        createdAt: savedCustomer.createdAt
      },
      message: 'Customer created successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Create customer error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during customer creation'
    } as APIResponse);
  }
});

/**
 * GET /api/customers/:customerId/qrcode
 * Generate QR code for customer
 */
router.get('/:customerId/qrcode', async (req: Request, res: Response) => {
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

    const { customerId } = req.params;
    const { amount } = req.query;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'Customer ID is required'
      } as APIResponse);
    }

    // Find customer
    const customer = await Customer.findOne({
      customerId,
      isActive: true
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found or inactive'
      } as APIResponse);
    }

    // Generate QR code data
    const qrCodeData = customer.generateUpiQrData(amount ? parseFloat(amount as string) : undefined);

    // Generate QR code URL
    const qrCodeUrl = CashfreeService.generateQrCodeDataUrl(qrCodeData);

    console.log('QR code generated for customer:', customerId);

    res.status(200).json({
      success: true,
      data: {
        customerId: customer.customerId,
        qrCodeData,
        qrCodeUrl,
        upiId: customer.upiId,
        name: customer.upiName || customer.name,
        amount: amount ? parseFloat(amount as string) : undefined
      },
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
 * POST /api/customers/:customerId/beneficiary/add
 * Add customer as Cashfree beneficiary
 */
router.post('/:customerId/beneficiary/add', async (req: Request, res: Response) => {
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

    const { customerId } = req.params;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'Customer ID is required'
      } as APIResponse);
    }

    // Find customer
    const customer = await Customer.findOne({
      customerId,
      isActive: true
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found or inactive'
      } as APIResponse);
    }

    if (customer.isBeneficiaryAdded && customer.cashfreeBeneficiaryId) {
      return res.status(409).json({
        success: false,
        error: 'Customer is already registered as a beneficiary',
        data: {
          beneficiaryId: customer.cashfreeBeneficiaryId
        }
      } as APIResponse);
    }

    // Get beneficiary details
    const beneficiaryDetails = customer.getBeneficiaryDetails();

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    // Add beneficiary to Cashfree
    const beneficiaryResult = await cashfreeService.addBeneficiary(beneficiaryDetails);

    if (beneficiaryResult.status === 'SUCCESS') {
      // Update customer with beneficiary ID
      customer.cashfreeBeneficiaryId = beneficiaryResult.data.beneficiary_id;
      customer.isBeneficiaryAdded = true;
      await customer.save();

      console.log('Beneficiary added successfully for customer:', customerId);
    }

    res.status(200).json({
      success: true,
      data: {
        customerId: customer.customerId,
        beneficiaryId: customer.cashfreeBeneficiaryId,
        beneficiaryDetails: beneficiaryResult.data,
        isBeneficiaryAdded: customer.isBeneficiaryAdded
      },
      message: 'Beneficiary added successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Add beneficiary error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during beneficiary addition'
    } as APIResponse);
  }
});

/**
 * GET /api/customers
 * Get all customers (for testing/admin purposes)
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

    const { limit = 50, offset = 0, testMode } = req.query;

    const filter: any = { isActive: true };
    if (testMode !== undefined) {
      filter.isTestMode = testMode === 'true';
    }

    const customers = await Customer.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(offset as string));

    const totalCount = await Customer.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        customers: customers.map(customer => ({
          customerId: customer.customerId,
          name: customer.name,
          email: customer.email,
          upiId: customer.upiId,
          isBeneficiaryAdded: customer.isBeneficiaryAdded,
          cashfreeBeneficiaryId: customer.cashfreeBeneficiaryId,
          isTestMode: customer.isTestMode,
          totalPaid: customer.totalPaid,
          transactionCount: customer.transactionCount,
          createdAt: customer.createdAt
        })),
        pagination: {
          total: totalCount,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        }
      },
      message: 'Customers retrieved successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during customers retrieval'
    } as APIResponse);
  }
});

export default router;
