import { Router, Request, Response } from 'express';
import { AutoBeneficiaryService } from '../services/autoBeneficiaryService';
import { config } from '../services/config';
import { APIResponse } from '../types';

const router = Router();

/**
 * POST /api/auto-beneficiary/create
 * Automatically creates a beneficiary from UPI QR data
 * Body: { upiDetails: { pa: string, pn?: string, am?: string, cu?: string } }
 */
router.post('/create', async (req: Request, res: Response) => {
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
    const { upiDetails } = req.body;
    if (!upiDetails || !upiDetails.pa) {
      return res.status(400).json({
        success: false,
        error: 'UPI details with pa (UPI ID) are required'
      } as APIResponse);
    }

    console.log('🔄 Auto-beneficiary creation request:', upiDetails);

    // Create auto-beneficiary service
    const autoBeneficiaryService = new AutoBeneficiaryService();

    // Create beneficiary from UPI details
    const result = await autoBeneficiaryService.createBeneficiaryFromUPI(upiDetails);

    if (result.success) {
      res.status(200).json({
        success: true,
        data: {
          beneficiaryId: result.beneficiaryId,
          customerId: result.customerId,
          isNewBeneficiary: result.isNewBeneficiary,
          upiId: upiDetails.pa,
          merchantName: upiDetails.pn || 'Unknown Merchant'
        },
        message: result.isNewBeneficiary 
          ? 'Beneficiary created successfully' 
          : 'Beneficiary already exists'
      } as APIResponse);
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to create beneficiary'
      } as APIResponse);
    }

  } catch (error) {
    console.error('Auto-beneficiary creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during beneficiary creation'
    } as APIResponse);
  }
});


export default router;
