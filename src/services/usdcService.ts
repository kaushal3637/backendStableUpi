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
      'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
      'function balanceOf(address account) external view returns (uint256)',
      'function decimals() external view returns (uint8)',
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function allowance(address owner, address spender) external view returns (uint256)'
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
   * Refunds USDC from treasury (backend signer) to a recipient
   */
  public async refundFromTreasury(to: string, amount: string): Promise<USDCTansferResponse> {
    try {
      if (!ethers.isAddress(to)) {
        throw new Error('Invalid recipient address');
      }

      const amountWei = ethers.parseUnits(amount, 6);
      if (amountWei <= 0n) {
        throw new Error('Invalid refund amount');
      }

      // Use transferFrom from treasury to recipient. Assumes treasury approved backend signer.
      const treasuryAddress = config.treasuryAddress;
      const spender = await this.signer.getAddress();

      // Optional: check allowance
      const currentAllowance = await this.usdcContract.allowance(treasuryAddress, spender);
      if (currentAllowance < amountWei) {
        throw new Error('Insufficient allowance from treasury to backend signer for refund');
      }

      // Execute transferFrom using backend signer as spender
      const tx = await this.usdcContract.transferFrom(treasuryAddress, to, amountWei);
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('USDC refund transfer failed');
      }

      return {
        success: true,
        transactionHash: receipt.hash
      };

    } catch (error) {
      console.error('USDC refund failed:', error);
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
   * Verifies if a USDC transfer occurred by checking transaction logs
   */
  public async verifyTransferInTransaction(txHash: string, from: string, to: string, expectedAmount: string): Promise<{
    verified: boolean;
    actualAmount?: string;
    error?: string;
  }> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { verified: false, error: 'Transaction receipt not found' };
      }

      // USDC Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
      const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      
      // Look for Transfer events from USDC contract
      const usdcContractAddress = await this.usdcContract.getAddress();
      const transferLogs = receipt.logs.filter(log => 
        log.address.toLowerCase() === usdcContractAddress.toLowerCase() &&
        log.topics[0] === transferEventSignature &&
        log.topics[1] === ethers.zeroPadValue(from.toLowerCase(), 32) &&
        log.topics[2] === ethers.zeroPadValue(to.toLowerCase(), 32)
      );

      if (transferLogs.length === 0) {
        console.log('DEBUG: Transaction receipt analysis:');
        console.log('  Total logs:', receipt.logs.length);
        console.log('  USDC contract address:', usdcContractAddress);
        console.log('  Looking for Transfer events from:', from, 'to:', to);
        
        // Check if there are any logs at all from the USDC contract
        const usdcLogs = receipt.logs.filter(log => 
          log.address.toLowerCase() === usdcContractAddress.toLowerCase()
        );
        console.log('  USDC contract logs:', usdcLogs.length);
        
        // Check for any Transfer events (regardless of from/to)
        const anyTransferLogs = receipt.logs.filter(log => 
          log.address.toLowerCase() === usdcContractAddress.toLowerCase() &&
          log.topics[0] === transferEventSignature
        );
        console.log('  Any USDC Transfer events:', anyTransferLogs.length);
        
        if (anyTransferLogs.length === 0) {
          return { verified: false, error: 'No USDC transfer events found in transaction' };
        } else {
          // We found at least one USDC transfer event, but not matching from/to.
          // This is not a fatal error for the function, but we should return not verified.
          return { 
            verified: false, 
            error: `No USDC transfer event found from ${from} to ${to}, but found ${anyTransferLogs.length} USDC transfer event(s) in transaction.` 
          };
        }
      }

      // At this point, we have at least one matching transfer log
      const transferLog = transferLogs[0];
      if (!transferLog) {
        // This should not happen, but for safety
        return { verified: false, error: 'Unexpected error: transferLog is undefined' };
      }
      const actualAmount = ethers.formatUnits(transferLog.data, 6);
      const expectedAmountFormatted = parseFloat(expectedAmount);
      const actualAmountFormatted = parseFloat(actualAmount);

      const verified = Math.abs(expectedAmountFormatted - actualAmountFormatted) < 0.000001; // Allow for minor precision differences

      return {
        verified,
        actualAmount,
        error: verified ? undefined : `Amount mismatch: expected ${expectedAmount}, got ${actualAmount}`
      };

    } catch (error) {
      console.error('Error verifying USDC transfer:', error);
      return {
        verified: false,
        error: error instanceof Error ? error.message : 'Unknown verification error'
      };
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
