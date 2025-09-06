import { ethers } from 'ethers';
import { USDCTansferRequest, USDCTansferResponse } from '../types';
import { config } from './config';

export class USDCService {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private usdcContract: ethers.Contract;

  constructor(chainId: number) {
    const blockchainConfig = config.getBlockchainConfig(chainId);
    this.provider = new ethers.JsonRpcProvider(blockchainConfig.rpcUrl);
    this.signer = new ethers.Wallet(config.backendPrivateKey, this.provider);

    // USDC Contract ABI (minimal)
    const usdcAbi = [
      'function transfer(address to, uint256 amount) external returns (bool)',
      'function balanceOf(address account) external view returns (uint256)',
      'function decimals() external view returns (uint8)',
      'function approve(address spender, uint256 amount) external returns (bool)'
    ];

    this.usdcContract = new ethers.Contract(
      blockchainConfig.usdcContractAddress,
      usdcAbi,
      this.signer
    );
  }

  /**
   * Transfers USDC to treasury address
   */
  public async transferToTreasury(request: USDCTansferRequest): Promise<USDCTansferResponse> {
    try {
      // Validate addresses
      if (!ethers.isAddress(request.from) || !ethers.isAddress(request.to)) {
        throw new Error('Invalid address format');
      }

      // Validate amount
      const amount = ethers.parseUnits(request.amount, 6); // USDC has 6 decimals

      if (amount <= 0n) {
        throw new Error('Invalid transfer amount');
      }

      // Check balance before transfer
      const balance = await this.usdcContract.balanceOf(request.from);
      if (balance < amount) {
        throw new Error('Insufficient USDC balance');
      }

      // Execute transfer
      const tx = await this.usdcContract.transfer(request.to, amount);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('USDC transfer failed');
      }

      return {
        success: true,
        transactionHash: receipt.hash
      };

    } catch (error) {
      console.error('USDC transfer failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Gets USDC balance for an address
   */
  public async getBalance(address: string): Promise<string> {
    try {
      if (!ethers.isAddress(address)) {
        throw new Error('Invalid address format');
      }

      const balance = await this.usdcContract.balanceOf(address);
      return ethers.formatUnits(balance, 6); // USDC has 6 decimals
    } catch (error) {
      console.error('Failed to get USDC balance:', error);
      throw new Error('Failed to retrieve balance');
    }
  }

  /**
   * Approves spending of USDC tokens
   */
  public async approve(spender: string, amount: string): Promise<string> {
    try {
      if (!ethers.isAddress(spender)) {
        throw new Error('Invalid spender address');
      }

      const amountWei = ethers.parseUnits(amount, 6);
      const tx = await this.usdcContract.approve(spender, amountWei);

      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      console.error('USDC approval failed:', error);
      throw new Error('Failed to approve USDC spending');
    }
  }

  /**
   * Transfers USDC from one address to treasury (if approved)
   */
  public async transferFrom(from: string, to: string, amount: string): Promise<USDCTansferResponse> {
    try {
      if (!ethers.isAddress(from) || !ethers.isAddress(to)) {
        throw new Error('Invalid address format');
      }

      const amountWei = ethers.parseUnits(amount, 6);

      // First approve the transfer if not already approved
      await this.approve(from, amount);

      // Execute transferFrom
      const tx = await this.usdcContract.transferFrom(from, to, amountWei);

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('USDC transferFrom failed');
      }

      return {
        success: true,
        transactionHash: receipt.hash
      };

    } catch (error) {
      console.error('USDC transferFrom failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}
