import { Router, Request, Response } from 'express';
import Joi from 'joi';
import mongoose from 'mongoose';
import { CashfreeService, CashfreeBeneficiary } from '../services/cashfreeService';
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
  beneficiary_id: Joi.string().required().trim(),
  beneficiary_name: Joi.string().required().trim(),
  beneficiary_instrument_details: Joi.object({
    bank_account_number: Joi.string().optional(),
    bank_ifsc: Joi.string().optional(),
    vpa: Joi.string().optional().pattern(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'UPI ID format')
  }).required(),
  beneficiary_contact_details: Joi.object({
    beneficiary_email: Joi.string().email().optional(),
    beneficiary_phone: Joi.string().optional(),
    beneficiary_country_code: Joi.string().optional(),
    beneficiary_address: Joi.string().optional(),
    beneficiary_city: Joi.string().optional(),
    beneficiary_state: Joi.string().optional(),
    beneficiary_postal_code: Joi.string().optional()
  }).optional()
});

const transferRequestSchema = Joi.object({
  transferId: Joi.string().required(),
  transferAmount: Joi.number().positive().required(),
  beneficiaryId: Joi.string().required(),
  beneficiaryName: Joi.string().required(),
  beneficiaryVpa: Joi.string().required().pattern(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'UPI ID format'),
  transferRemarks: Joi.string().optional(),
  fundsourceId: Joi.string().optional()
});

const initiatePayoutSchema = Joi.object({
  customerId: Joi.string().required(),
  amount: Joi.number().positive().max(25000).required(),
  remarks: Joi.string().optional(),
  transferId: Joi.string().optional(),
  fundsourceId: Joi.string().optional()
});

/**
 * POST /api/cashfree/beneficiary/add
 * Add a beneficiary for payouts using Cashfree V2 API format
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

    const {
      beneficiary_id,
      beneficiary_name,
      beneficiary_instrument_details,
      beneficiary_contact_details
    } = value;

    // Validate that at least one instrument detail is provided
    const hasBankDetails = beneficiary_instrument_details.bank_account_number &&
                          beneficiary_instrument_details.bank_ifsc;
    const hasVPA = beneficiary_instrument_details.vpa;

    if (!hasBankDetails && !hasVPA) {
      return res.status(400).json({
        success: false,
        error: "Either bank account details (bank_account_number and bank_ifsc) or VPA must be provided"
      } as APIResponse);
    }

    console.log('Adding beneficiary:', beneficiary_id);

    // Create CashfreeBeneficiary object for the service
    const beneficiary: CashfreeBeneficiary = {
      beneId: beneficiary_id,
      name: beneficiary_name,
      email: beneficiary_contact_details?.beneficiary_email || "",
      phone: beneficiary_contact_details?.beneficiary_phone || "",
      address1: beneficiary_contact_details?.beneficiary_address || "Test Address",
      city: beneficiary_contact_details?.beneficiary_city || "Test City",
      state: beneficiary_contact_details?.beneficiary_state || "Test State",
      pincode: beneficiary_contact_details?.beneficiary_postal_code || "110001",
      ...(hasBankDetails && {
        bankAccount: {
          accountNumber: beneficiary_instrument_details.bank_account_number!,
          ifsc: beneficiary_instrument_details.bank_ifsc!,
          accountHolderName: beneficiary_name
        }
      }),
      ...(hasVPA && {
        vpa: beneficiary_instrument_details.vpa
      })
    };

    // Initialize Cashfree service and add beneficiary
    const cashfreeService = new CashfreeService();
    const result = await cashfreeService.addBeneficiary(beneficiary);

    res.status(200).json({
      success: true,
      message: "Beneficiary added successfully",
      data: result.data,
    } as APIResponse);

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
 * Get beneficiary details by beneficiary ID
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

    console.log('Getting beneficiary details by ID:', beneId);

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    // Get beneficiary details
    const result = await cashfreeService.getBeneficiary(beneId);

    res.status(200).json({
      success: true,
      data: {
        beneficiary: result
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
 * POST /api/cashfree/transfer/initiate
 * Initiate a transfer using Cashfree API
 */
router.post('/transfer/initiate', async (req: Request, res: Response) => {
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
    const { error, value } = transferRequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    console.log('Initiating Cashfree transfer:', value.transferId);

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    // Initiate transfer
    const result = await cashfreeService.initiateTransfer(value);

    const isSuccessful = result.status === 'SUCCESS' || result.status === 'RECEIVED';

    res.status(isSuccessful ? 200 : 400).json({
      success: isSuccessful,
      data: result,
      message: result.message
    } as APIResponse);

  } catch (error: any) {
    console.error('Transfer initiation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during transfer initiation'
    } as APIResponse);
  }
});

/**
 * POST /api/cashfree/payouts/initiate
 * Initiates a UPI payout to a customer via Cashfree Payout API
 * This endpoint mimics the frontend API structure
 */
router.post('/payouts/initiate', async (req: Request, res: Response) => {
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
    const { error, value } = initiatePayoutSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Validation error: ${error.details[0].message}`
      } as APIResponse);
    }

    const { customerId, amount, remarks, transferId, fundsourceId } = value;

    // Connect to database
    await connectDB();

    // Find customer - try multiple lookup strategies
    let customer = null;
    console.log('🔍 Customer lookup for:', customerId);

    // Special case: If customerId looks like a Cashfree beneficiary ID (long, no @),
    // we should use it directly and create/find a customer record for it
    if (customerId && customerId.length > 20 && !customerId.includes('@')) {
      console.log('🎯 Detected Cashfree beneficiary ID format, using direct lookup...');

      // Try to find existing customer with this beneficiary ID
      // Since we don't have cashfreeBeneficiaryId field, we'll use _id
      try {
        if (mongoose.Types.ObjectId.isValid(customerId)) {
          customer = await Customer.findOne({
            _id: customerId,
            isActive: true
          });
        }
      } catch (error) {
        console.log('Invalid beneficiary ID format');
      }

      if (customer) {
        console.log('✅ Found existing customer with matching beneficiary ID');
      } else {
        console.log('❌ No customer found with beneficiary ID, will create new one');
      }
    } else {
      // Strategy 1: Try to find by _id (for existing customers)
      try {
        if (mongoose.Types.ObjectId.isValid(customerId)) {
          customer = await Customer.findOne({
            _id: customerId,
            isActive: true
          });
          console.log('Strategy 1 - Found by _id:', customer ? `YES (${customer._id})` : 'NO');
        }
      } catch (error) {
        console.log('Strategy 1 - Invalid ObjectId format');
      }

      // Strategy 2: If still not found and customerId looks like a UPI ID,
      // try to find by vpa
      if (!customer && customerId && customerId.includes('@')) {
        customer = await Customer.findByVpa(customerId);
        console.log('Strategy 2 - Found by vpa:', customer ? `YES (${customer.vpa})` : 'NO');
      }
    }

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found, inactive, or not registered as beneficiary",
        details: `Searched for customerId: ${customerId}. Make sure the customer exists and is registered as a beneficiary.`,
        customerIdReceived: customerId,
        customerIdType: customerId?.includes('@') ? 'UPI_ID' : (customerId?.length > 20 ? 'BENEFICIARY_ID' : 'CUSTOMER_ID')
      } as APIResponse);
    }

    // Generate transfer ID if not provided
    const finalTransferId = transferId || `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();

    let transferResponse = null;
    let transferError = null;

    try {
      // Sanitize remarks for Cashfree API (remove special chars, limit length)
      const sanitizedRemarks = (remarks || `Pay ${customer.name}`)
        .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
        .substring(0, 30) // Limit to 30 chars
        .trim();

      console.log('Original remarks:', remarks);
      console.log('Sanitized remarks:', sanitizedRemarks);

      // Initiate payout transfer using the exact API format
      const actualBeneficiaryId = customer._id.toString();
      console.log('📋 Using beneficiary ID for transfer:', actualBeneficiaryId);

      transferResponse = await cashfreeService.initiateTransfer({
        transferId: finalTransferId,
        transferAmount: amount,
        beneficiaryId: actualBeneficiaryId,
        beneficiaryName: customer.name,
        beneficiaryVpa: customer.vpa,
        transferRemarks: sanitizedRemarks,
        fundsourceId: fundsourceId,
      });

      // Update customer statistics if transfer was successful
      const isSuccessful = transferResponse.status === 'SUCCESS' || transferResponse.status === 'RECEIVED';
      if (isSuccessful) {
        customer.totalPaid += amount;
        customer.transactionCount += 1;
        customer.lastPaymentAt = new Date();
        await customer.save();
        console.log('✅ Updated customer statistics for successful transfer');
      }

    } catch (error) {
      console.error('Payout initiation error:', error);
      transferError = error instanceof Error ? error.message : 'Unknown error';
    }

    // Determine if the transfer was successful
    const isSuccessful = transferResponse?.status === 'SUCCESS' || transferResponse?.status === 'RECEIVED';

    // Return response
    return res.status(isSuccessful ? 200 : 400).json({
      success: isSuccessful,
      payout: {
        transferId: finalTransferId,
        amount,
        status: transferResponse?.status || 'FAILED',
        message: transferResponse?.message || transferError,
        referenceId: transferResponse?.data?.referenceId || transferResponse?.data?.transfer_id,
        utr: transferResponse?.data?.utr,
        acknowledged: transferResponse?.data?.acknowledged,
        initiatedAt: new Date().toISOString(),
      },
      customer: {
        customerId: customer._id.toString(),
        name: customer.name,
        email: `${customer.name.toLowerCase().replace(/\s+/g, '')}@example.com`, // Generate email since it's not in schema
        upiId: customer.vpa,
        totalPaid: customer.totalPaid,
        transactionCount: customer.transactionCount,
      },
      transferDetails: transferResponse?.data,
      error: transferError,
    } as APIResponse);

  } catch (error: any) {
    console.error("Error initiating payout:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error while initiating payout",
      details: error.message
    } as APIResponse);
  }
});

/**
 * GET /api/cashfree/transfer/status/:transferId
 * Get transfer status
 */
router.get('/transfer/status/:transferId', async (req: Request, res: Response) => {
  try {
    // Validate API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      } as APIResponse);
    }

    const { transferId } = req.params;

    if (!transferId) {
      return res.status(400).json({
        success: false,
        error: 'Transfer ID is required'
      } as APIResponse);
    }

    console.log('Getting transfer status for:', transferId);

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

  } catch (error: any) {
    console.error('Transfer status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during status check'
    } as APIResponse);
  }
});

/**
 * GET /api/cashfree/payouts/status/:transferId
 * Get payout status (alias for transfer status to match frontend API)
 */
router.get('/payouts/status/:transferId', async (req: Request, res: Response) => {
  // Redirect to the transfer status endpoint by calling the same logic
  const transferId = req.params.transferId;
  
  if (!transferId) {
    return res.status(400).json({
      success: false,
      error: 'Transfer ID is required'
    } as APIResponse);
  }

  try {
    const cashfreeService = new CashfreeService();
    const statusResponse = await cashfreeService.getTransferStatus(transferId);

    return res.status(200).json({
      success: statusResponse.status === 'SUCCESS',
      status: statusResponse.status,
      message: statusResponse.message,
      transferDetails: statusResponse.data,
      requestedAt: new Date().toISOString(),
    } as APIResponse);

  } catch (error: any) {
    console.error('Payout status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during status check'
    } as APIResponse);
  }
});

/**
 * GET /api/cashfree/health
 * Health check for Cashfree service
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();
    
    // Perform health check
    const healthResult = await cashfreeService.healthCheck();
    
    res.status(200).json({
      success: true,
      status: healthResult.status,
      service: 'Cashfree Payout Service',
      message: healthResult.message,
      timestamp: healthResult.timestamp,
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
 * GET /api/cashfree/test/auth
 * Test Cashfree authentication
 */
router.get('/test/auth', async (req: Request, res: Response) => {
  try {
    // Initialize Cashfree service
    const cashfreeService = new CashfreeService();
    
    // Test authentication
    const authResult = await cashfreeService.testAuthentication();
    
    res.status(authResult.success ? 200 : 400).json({
      success: authResult.success,
      message: authResult.success ? 'Authentication successful' : 'Authentication failed',
      token: authResult.token,
      error: authResult.error,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Authentication test failed',
      details: error.message
    });
  }
});

export default router;
