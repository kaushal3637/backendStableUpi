import { ethers } from 'ethers';
import { UserOperation, ERC7702Request, ERC7702Response } from '../types';
import { config } from './config';

export class UserOpService {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;

  constructor(chainId: number) {
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
      // For ERC-7702, we need to use the EntryPoint contract
      const blockchainConfig = config.getBlockchainConfig(parseInt(await this.provider.getNetwork().then(n => n.chainId.toString())));

      // Create EntryPoint contract instance
      const entryPointAbi = [
        'function handleOps((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[], address) external'
      ];

      const entryPoint = new ethers.Contract(
        blockchainConfig.entryPointAddress,
        entryPointAbi,
        this.signer
      );

      // Execute the UserOperation through EntryPoint
      const tx = await entryPoint.handleOps([userOp], this.signer.address);

      // Wait for transaction confirmation
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('UserOp execution failed');
      }

      return receipt.hash;
    } catch (error) {
      console.error('Error executing UserOp:', error);
      throw new Error(`UserOp execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Processes the complete ERC-7702 request
   */
  public async processERC7702Request(request: ERC7702Request): Promise<ERC7702Response> {
    try {
      // Validate UserOp
      const isValid = await this.validateUserOp(request.userOp);
      if (!isValid) {
        return {
          success: false,
          status: 'failed',
          error: 'Invalid UserOperation'
        };
      }

      // Execute UserOp
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
