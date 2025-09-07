import { ethers } from 'ethers';
import { UserOperation, ERC7702Request, ERC7702Response } from '../types';
import { config } from './config';

export class UserOpService {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
    const blockchainConfig = config.getBlockchainConfig(chainId);
    this.provider = new ethers.JsonRpcProvider(blockchainConfig.rpcUrl);
    this.signer = new ethers.Wallet(config.backendPrivateKey, this.provider);
  }

  /**
   * Validates the UserOperation structure and parameters
   */
  public async validateUserOp(userOp: UserOperation): Promise<boolean> {
    try {
      // Basic validation checks
      if (!userOp.sender || !ethers.isAddress(userOp.sender)) {
        throw new Error('Invalid sender address');
      }

      if (!userOp.callData || userOp.callData === '0x') {
        throw new Error('Invalid callData');
      }

      // Validate all fields are properly formatted hex strings
      const hexFields = ['nonce', 'initCode', 'callData', 'callGasLimit', 'verificationGasLimit',
                        'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'paymasterAndData', 'signature'];

      for (const field of hexFields) {
        const value = userOp[field as keyof UserOperation];
        if (typeof value !== 'string' || !value.startsWith('0x')) {
          throw new Error(`Invalid ${field}: must be a hex string starting with 0x`);
        }
      }

      // Validate gas limits are reasonable
      const callGasLimit = BigInt(userOp.callGasLimit);
      const verificationGasLimit = BigInt(userOp.verificationGasLimit);
      const preVerificationGas = BigInt(userOp.preVerificationGas);

      if (callGasLimit <= 0n || verificationGasLimit <= 0n || preVerificationGas <= 0n) {
        throw new Error('Invalid gas limits');
      }

      // Validate signature exists
      if (!userOp.signature || userOp.signature === '0x') {
        throw new Error('Missing signature');
      }

      return true;
    } catch (error) {
      console.error('UserOp validation failed:', error);
      return false;
    }
  }

  /**
   * Executes the UserOperation
   */
  public async executeUserOp(userOp: UserOperation): Promise<string> {
    try {
      // Check network first
      const network = await this.provider.getNetwork();
      console.log('Network:', network.name, 'Chain ID:', network.chainId);
      console.log('Expected Chain ID:', this.chainId);

      if (Number(network.chainId) !== this.chainId) {
        console.warn(`Network mismatch! Connected to ${network.name} (${network.chainId}) but expected chain ${this.chainId}`);
      }

      // Note: This is legacy UserOp execution - for EIP-7702, we should use the EIP7702Service instead
      console.warn('⚠️  Warning: Legacy UserOp execution is deprecated. Use EIP-7702 sponsored transactions instead.');
      
      // Legacy UserOp execution is not supported in EIP-7702 architecture
      throw new Error('Legacy UserOp execution not supported. Please use EIP-7702 sponsored transactions via the /api/payments/process endpoint with sponsoredRequest.');
    } catch (error) {
      console.error('Error executing UserOp:', error);
      throw new Error(`UserOp execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Processes the complete ERC-7702 request (LEGACY - Use EIP7702Service instead)
   */
  public async processERC7702Request(request: ERC7702Request): Promise<ERC7702Response> {
    try {
      // Check if this is a legacy UserOp request
      if (!request.userOp) {
        return {
          success: false,
          status: 'failed',
          error: 'Legacy UserOp not provided. Use EIP-7702 sponsored transactions instead.'
        };
      }

      // Validate UserOp
      const isValid = await this.validateUserOp(request.userOp);
      if (!isValid) {
        return {
          success: false,
          status: 'failed',
          error: 'Invalid UserOperation'
        };
      }

      // Execute UserOp (will throw error directing to use EIP-7702)
      const transactionHash = await this.executeUserOp(request.userOp);

      return {
        success: true,
        transactionHash,
        status: 'completed'
      };

    } catch (error) {
      console.error('Error processing ERC-7702 request:', error);
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Estimates gas for UserOperation
   */
  public async estimateGas(userOp: UserOperation): Promise<{
    callGasLimit: string;
    verificationGasLimit: string;
    preVerificationGas: string;
  }> {
    try {
      // Basic gas estimation - in production, you'd want more sophisticated estimation
      const estimatedCallGas = await this.provider.estimateGas({
        to: userOp.sender,
        data: userOp.callData,
      });

      return {
        callGasLimit: (estimatedCallGas * 120n / 100n).toString(), // 20% buffer
        verificationGasLimit: '100000', // Standard verification gas
        preVerificationGas: '21000', // Base gas for transaction
      };
    } catch (error) {
      console.error('Gas estimation failed:', error);
      throw new Error('Failed to estimate gas');
    }
  }
}
