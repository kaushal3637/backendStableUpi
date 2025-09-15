import { Router, Request, Response } from 'express';
import Joi from 'joi';
import mongoose from 'mongoose';
import Customer from '../models/Customer';
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
  vpa: Joi.string().required().trim().pattern(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'UPI ID format'),
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

    const { name, vpa, isTestMode = true } = value;

    // Check if customer already exists by VPA
    const existingCustomer = await Customer.findByVpa(vpa);

    if (existingCustomer) {
      return res.status(200).json({
        success: true,
        message: 'Customer already exists',
        data: {
          beneficiaryId: existingCustomer._id.toString(),
          name: existingCustomer.name,
          vpa: existingCustomer.vpa,
          isActive: existingCustomer.isActive
        }
      } as APIResponse);
    }

    // Create new customer
    const customer = new Customer({
      name: name,
      vpa: vpa,
      isActive: true,
      isTestMode: isTestMode
    });

    const savedCustomer = await customer.save();

    console.log('✅ Customer created successfully:', savedCustomer._id);

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: {
        beneficiaryId: savedCustomer._id.toString(),
        name: savedCustomer.name,
        vpa: savedCustomer.vpa,
        isActive: savedCustomer.isActive,
        createdAt: savedCustomer.createdAt
      }
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
 * GET /api/customers/list
 * Get all customers
 */
router.get('/list', async (req: Request, res: Response) => {
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

    const customers = await Customer.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(offset as string));

    const totalCount = await Customer.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        customers: customers.map(customer => ({
          beneficiaryId: customer._id.toString(),
          name: customer.name,
          vpa: customer.vpa,
          isActive: customer.isActive,
          totalReceived: customer.totalReceived,
          totalPaid: customer.totalPaid,
          transactionCount: customer.transactionCount,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt
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
    console.error('List customers error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during customer retrieval'
    } as APIResponse);
  }
});

/**
 * GET /api/customers/:vpa
 * Get customer by VPA
 */
router.get('/:vpa', async (req: Request, res: Response) => {
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

    // Connect to database
    await connectDB();

    const customer = await Customer.findByVpa(vpa);

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
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
      message: 'Customer retrieved successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Get customer error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during customer retrieval'
    } as APIResponse);
  }
});

/**
 * PUT /api/customers/:vpa
 * Update customer by VPA
 */
router.put('/:vpa', async (req: Request, res: Response) => {
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
    const { name } = req.body;

    if (!vpa) {
      return res.status(400).json({
        success: false,
        error: 'VPA is required'
      } as APIResponse);
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      } as APIResponse);
    }

    // Connect to database
    await connectDB();

    const customer = await Customer.findByVpa(vpa);

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      } as APIResponse);
    }

    // Update customer
    customer.name = name.trim();
    customer.updatedAt = new Date();

    const updatedCustomer = await customer.save();

    res.status(200).json({
      success: true,
      data: {
        beneficiaryId: updatedCustomer._id.toString(),
        name: updatedCustomer.name,
        vpa: updatedCustomer.vpa,
        isActive: updatedCustomer.isActive,
        updatedAt: updatedCustomer.updatedAt
      },
      message: 'Customer updated successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Update customer error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during customer update'
    } as APIResponse);
  }
});

/**
 * DELETE /api/customers/:vpa
 * Soft delete customer by VPA
 */
router.delete('/:vpa', async (req: Request, res: Response) => {
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

    // Connect to database
    await connectDB();

    const customer = await Customer.findByVpa(vpa);

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      } as APIResponse);
    }

    // Soft delete - set isActive to false
    customer.isActive = false;
    customer.updatedAt = new Date();

    await customer.save();

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully'
    } as APIResponse);

  } catch (error: any) {
    console.error('Delete customer error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during customer deletion'
    } as APIResponse);
  }
});

export default router;