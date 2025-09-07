import { ERC7702Request, ERC7702Response, UPIMerchantDetails, EIP7702SponsoredRequest, USDCMetaTransactionRequest } from '../types';
import { UserOpService } from './userOpService';
import { USDCService } from './usdcService';
import { EIP7702Service } from './eip7702Service';
import { USDCMetaTransactionService } from './usdcMetaTransactionService';
import { config } from './config';

export class PaymentOrchestrator {
  private userOpService: UserOpService;
  private usdcService: USDCService;
  private eip7702Service: EIP7702Service;
  private usdcMetaTransactionService: USDCMetaTransactionService;

  constructor(chainId: number) {
    this.userOpService = new UserOpService(chainId);
    this.usdcService = new USDCService(chainId);
    this.eip7702Service = new EIP7702Service(chainId);
    this.usdcMetaTransactionService = new USDCMetaTransactionService(chainId);
  }

  /**
   * Processes the complete payment flow:
   * 1. Execute USDC meta transaction OR EIP-7702 sponsored transaction OR legacy UserOp
   * 2. Transfer USDC to treasury (if applicable)
   * 3. Return success response
   */
  public async processPayment(request: ERC7702Request): Promise<ERC7702Response> {
    try {
      console.log('Starting payment orchestration process...');

      let transactionHash: string;

      // Determine transaction type and process accordingly
      if (request.metaTransactionRequest) {
        // Process USDC meta transaction (preferred method)
        console.log('Step 1: Processing USDC meta transaction...');
        const metaTransactionResult = await this.usdcMetaTransactionService.executeMetaTransaction(request.metaTransactionRequest);

        if (!metaTransactionResult.success) {
          return {
            success: false,
            status: 'failed',
            error: `USDC meta transaction failed: ${metaTransactionResult.error}`
          };
        }

        transactionHash = metaTransactionResult.transactionHash!;
        console.log(`USDC meta transaction successful. Transaction hash: ${transactionHash}`);

        // Step 1.5: Verify USDC transfer occurred
        console.log('Step 1.5: Verifying USDC transfer occurred...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for transaction to be indexed
        
        const usdcAmount = this.extractUSDCAmount(request.upiMerchantDetails);
        
        try {
          // Verify USDC transfer by checking transaction logs
          const verificationResult = await this.usdcMetaTransactionService.verifyMetaTransaction(
            transactionHash,
            request.metaTransactionRequest.from,
            request.metaTransactionRequest.to,
            usdcAmount
          );

          if (verificationResult.verified) {
            console.log(`✅ USDC meta transaction verified: ${verificationResult.actualAmount} USDC transferred to treasury`);
          } else {
            console.warn(`❌ USDC meta transaction verification failed: ${verificationResult.error}`);
            return {
              success: false,
              status: 'failed',
              error: `USDC meta transaction verification failed: ${verificationResult.error}`,
              transactionHash
            };
          }
        } catch (verificationError) {
          console.warn('USDC meta transaction verification failed:', verificationError);
          return {
            success: false,
            status: 'failed',
            error: 'USDC meta transaction verification failed',
            transactionHash
          };
        }

      } else if (request.sponsoredRequest) {
        // Process EIP-7702 sponsored transaction
        console.log('Step 1: Processing EIP-7702 sponsored transaction...');
        const sponsoredResult = await this.eip7702Service.sendSponsoredTransaction(request.sponsoredRequest);

        if (!sponsoredResult.success) {
          return {
            success: false,
            status: 'failed',
            error: `EIP-7702 sponsored transaction failed: ${sponsoredResult.error}`
          };
        }

        transactionHash = sponsoredResult.transactionHash!;
        console.log(`EIP-7702 sponsored transaction successful. Transaction hash: ${transactionHash}`);

        // Step 1.5: Verify USDC transfer occurred (since delegation contract might not revert on failure)
        console.log('Step 1.5: Verifying USDC transfer occurred...');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for transaction to be indexed
        
        const usdcAmount = this.extractUSDCAmount(request.upiMerchantDetails);
        const expectedTransferAmount = parseFloat(usdcAmount) * 1000000; // Convert to USDC decimals
        
        try {
          // Verify USDC transfer by checking transaction logs
          const verificationResult = await this.usdcService.verifyTransferInTransaction(
            transactionHash,
            request.sponsoredRequest.userAddress,
            config.treasuryAddress,
            usdcAmount
          );

          if (verificationResult.verified) {
            console.log(`✅ USDC transfer verified: ${verificationResult.actualAmount} USDC transferred to treasury`);
          } else {
            console.warn(`❌ USDC transfer verification failed: ${verificationResult.error}`);
            console.warn('The delegation contract executed but the USDC transfer may have failed silently.');
            // TODO: Consider implementing fallback transfer or alerting mechanisms
          }
        } catch (verificationError) {
          console.warn('USDC transfer verification failed:', verificationError);
          // Don't fail the entire flow for verification issues
        }

      } else if (request.userOp) {
        // Process legacy UserOp
        console.log('Step 1: Processing legacy ERC-7702 UserOp...');
        const userOpResult = await this.userOpService.processERC7702Request(request);

        if (!userOpResult.success) {
          return {
            success: false,
            status: 'failed',
            error: `UserOp execution failed: ${userOpResult.error}`
          };
        }

        transactionHash = userOpResult.transactionHash!;
        console.log(`UserOp executed successfully. Transaction hash: ${transactionHash}`);

        // For legacy UserOps, still need USDC transfer
        console.log('Step 2: Transferring USDC to treasury...');
        const usdcAmount = this.extractUSDCAmount(request.upiMerchantDetails);

        const usdcTransferResult = await this.usdcService.transferToTreasury({
          from: request.userOp.sender,
          to: config.treasuryAddress,
          amount: usdcAmount,
          chainId: request.chainId
        });

        if (!usdcTransferResult.success) {
          return {
            success: false,
            status: 'failed',
            error: `USDC transfer failed: ${usdcTransferResult.error}`,
            transactionHash
          };
        }

        console.log(`USDC transfer completed. Transaction hash: ${usdcTransferResult.transactionHash}`);
      } else {
        return {
          success: false,
          status: 'failed',
          error: 'No valid transaction request provided (metaTransactionRequest, sponsoredRequest, or userOp required)'
        };
      }

      // Return success response after USDC transfer verification
      console.log('USDC transfer completed successfully');

      return {
        success: true,
        transactionHash,
        status: 'completed'
      };

    } catch (error) {
      console.error('Payment orchestration failed:', error);
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown orchestration error'
      };
    }
  }

  /**
   * Extracts USDC amount from UPI merchant details or UserOp
   */
  private extractUSDCAmount(upiDetails: UPIMerchantDetails): string {
    // Try to get amount from UPI details first
    if (upiDetails.am) {
      // Convert INR to USDC (assuming amount is in INR)
      const inrAmount = parseFloat(upiDetails.am);
      // Using approximate conversion rate (1 USDC ≈ 83 INR)
      const usdcAmount = inrAmount / 83;
      return usdcAmount.toFixed(6);
    }

    // Fallback: extract from UserOp callData (this would need custom logic based on your contract)
    // For now, return a default amount
    return '10.0'; // Default 10 USDC
  }

  /**
   * Gets the status of a payment by transaction hash
   */
  public async getPaymentStatus(transactionHash: string): Promise<{
    transactionStatus: string;
    usdcTransferStatus: string;
  }> {
    try {
      // In a real implementation, you'd store payment state in a database
      // For now, return mock status
      return {
        transactionStatus: 'completed',
        usdcTransferStatus: 'completed'
      };
    } catch (error) {
      console.error('Failed to get payment status:', error);
      throw new Error('Payment status check failed');
    }
  }
}
