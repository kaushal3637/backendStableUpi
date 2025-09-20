import { Router, Request, Response } from 'express';
import { config } from '../services/config';
import { chainalysisService } from '../services/chainalysisService';
import { allowlistService } from '../services/allowlistService';
import mongoose from 'mongoose';
import { ethers } from 'ethers';
import { APIResponse } from '../types';

const router = Router();

/**
 * POST /api/sanctions/check
 * Check if a wallet address is sanctioned (for wallet connection)
 */
router.post('/check', async (req: Request, res: Response) => {
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
    const { walletAddress } = req.body;
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      } as APIResponse);
    }

    // Validate wallet address format
    const ethereumAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!ethereumAddressRegex.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address format'
      } as APIResponse);
    }

    // Normalize and compute checksum
    const addressLower = walletAddress.toLowerCase();
    let checksumAddress = walletAddress;
    try {
      checksumAddress = ethers.getAddress(walletAddress);
    } catch {}

    // Ensure DB connection
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.DEVELOPMENT_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/stableupi');
    }

    // Check DB first for idempotency
    const existing = await allowlistService.getByWalletAddressLower(addressLower);
    if (existing) {
      return res.status(200).json({
        success: true,
        data: {
          walletAddress: existing.checksumAddress,
          isSanctioned: existing.isSanctioned,
          identifications: existing.identifications || [],
          screenedAt: existing.screenedAt,
          addedToAllowlist: !existing.isSanctioned
        },
        message: existing.isSanctioned ? 'Wallet address is sanctioned' : 'Wallet address is clean'
      } as APIResponse);
    }

    // Not found -> call Chainalysis
    const sanctionsResult = await chainalysisService.checkSanctions(walletAddress);

    // Persist result
    const saved = await allowlistService.upsertFromSanctionsResult({
      walletAddressLower: addressLower,
      checksumAddress,
      isSanctioned: sanctionsResult.isSanctioned,
      identifications: sanctionsResult.identifications || []
    });

    return res.status(200).json({
      success: true,
      data: {
        walletAddress: saved.checksumAddress,
        isSanctioned: saved.isSanctioned,
        identifications: saved.identifications || [],
        screenedAt: saved.screenedAt,
        addedToAllowlist: !saved.isSanctioned
      },
      message: saved.isSanctioned ? 'Wallet address is sanctioned' : 'Wallet address is clean'
    } as APIResponse);

  } catch (error: any) {
    console.error('Sanctions check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during sanctions check'
    } as APIResponse);
  }
});

export default router;
