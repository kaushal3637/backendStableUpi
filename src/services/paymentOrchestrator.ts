import { ERC7702Request, ERC7702Response, UPIMerchantDetails } from '../types';
import { UserOpService } from './userOpService';
import { USDCService } from './usdcService';
import { UPIService } from './upiService';
import { config } from './config';

export class PaymentOrchestrator {
  private userOpService: UserOpService;
  private usdcService: USDCService;
  private upiService: UPIService;

  constructor(chainId: number) {
    this.userOpService = new UserOpService(chainId);
    this.usdcService = new USDCService(chainId);
    this.upiService = new UPIService();
  }

  /**
   * Processes the complete payment flow:
   * 1. Execute ERC-7702 UserOp
   * 2. Transfer USDC to treasury
   * 3. Initiate UPI payment
   */
  public async processPayment(request: ERC7702Request): Promise<ERC7702Response> {
    try {
      console.log('Starting payment orchestration process...');

      // Step 1: Process ERC-7702 UserOp
      console.log('Step 1: Processing ERC-7702 UserOp...');
      const userOpResult = await this.userOpService.processERC7702Request(request);

      if (!userOpResult.success) {
        return {
          success: false,
          status: 'failed',
          error: `UserOp execution failed: ${userOpResult.error}`
        };
      }

      console.log(`UserOp executed successfully. Transaction hash: ${userOpResult.transactionHash}`);

      // Step 2: Transfer USDC to treasury
      console.log('Step 2: Transferring USDC to treasury...');

      // Extract the amount from UPI merchant details or UserOp
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
          transactionHash: userOpResult.transactionHash
        };
      }

      console.log(`USDC transfer completed. Transaction hash: ${usdcTransferResult.transactionHash}`);

      // Step 3: Initiate UPI payment
      console.log('Step 3: Initiating UPI payment...');

      const upiPaymentResult = await this.upiService.initiatePayment({
        merchantDetails: request.upiMerchantDetails,
        amount: this.convertUSDCToINR(usdcAmount),
        currency: 'INR',
        transactionId: userOpResult.transactionHash || `tx_${Date.now()}`
      });

      if (!upiPaymentResult.success) {
        return {
          success: false,
          status: 'failed',
          error: `UPI payment initiation failed: ${upiPaymentResult.error}`,
          transactionHash: userOpResult.transactionHash
        };
      }

      console.log(`UPI payment initiated successfully. Payment ID: ${upiPaymentResult.paymentId}`);

      return {
        success: true,
        transactionHash: userOpResult.transactionHash,
        upiPaymentId: upiPaymentResult.paymentId,
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
   * Converts USDC amount back to INR for UPI payment
   */
  private convertUSDCToINR(usdcAmount: string): string {
    const amount = parseFloat(usdcAmount);
    // Using approximate conversion rate (1 USDC ≈ 83 INR)
    const inrAmount = amount * 83;
    return inrAmount.toFixed(2);
  }

  /**
   * Gets the status of a payment by transaction hash
   */
  public async getPaymentStatus(transactionHash: string): Promise<{
    userOpStatus: string;
    usdcTransferStatus: string;
    upiPaymentStatus: string;
  }> {
    try {
      // In a real implementation, you'd store payment state in a database
      // For now, return mock status
      return {
        userOpStatus: 'completed',
        usdcTransferStatus: 'completed',
        upiPaymentStatus: 'initiated'
      };
    } catch (error) {
      console.error('Failed to get payment status:', error);
      throw new Error('Payment status check failed');
    }
  }
}
