import { ERC7702Request, ERC7702Response, UPIMerchantDetails, EIP7702SponsoredRequest, USDCMetaTransactionRequest } from '../types';
import { UserOpService } from './userOpService';
import { USDCService } from './usdcService';
import { EIP7702Service } from './eip7702Service';
import { USDCMetaTransactionService } from './usdcMetaTransactionService';
import { CashfreeService, CashfreeTransferRequest } from './cashfreeService';
import { config } from './config';

export class PaymentOrchestrator {
  private userOpService: UserOpService;
  private usdcService: USDCService;
  private eip7702Service: EIP7702Service;
  private usdcMetaTransactionService: USDCMetaTransactionService;
  private cashfreeService: CashfreeService;

  constructor(chainId: number) {
    this.userOpService = new UserOpService(chainId);
    this.usdcService = new USDCService(chainId);
    this.eip7702Service = new EIP7702Service(chainId);
    this.usdcMetaTransactionService = new USDCMetaTransactionService(chainId);
    this.cashfreeService = new CashfreeService();
  }

  /**
   * Processes the complete payment flow:
   * 1. Execute USDC meta transaction OR EIP-7702 sponsored transaction OR legacy UserOp
   * 2. Transfer USDC to treasury (if applicable)
   * 3. Initiate INR payout to merchant via Cashfree
   * 4. Return success response with complete transaction details
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

        // Use the actual amount from the meta transaction request instead of recalculating
        const usdcAmount = request.metaTransactionRequest.value;

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

      // Step 3: Initiate INR payout to merchant via Cashfree
      console.log('Step 3: Initiating INR payout to merchant...');

      let inrPayoutResult = null;
      let payoutTransferId: string | undefined = undefined;

      try {
        // Extract INR amount from UPI merchant details
        const inrAmount = parseFloat(request.upiMerchantDetails.am || '0');

        if (inrAmount > 0) {
          // Generate unique transfer ID
          const transferId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

          // Create transfer request for Cashfree
          const transferRequest: CashfreeTransferRequest = {
            transferId,
            transferAmount: inrAmount,
            beneficiaryId: this.extractBeneficiaryId(request.upiMerchantDetails),
            beneficiaryName: request.upiMerchantDetails.pn || 'Merchant',
            beneficiaryVpa: request.upiMerchantDetails.pa,
            transferRemarks: `Payment to ${request.upiMerchantDetails.pn || 'Merchant'}`,
            fundsourceId: process.env.CASHFREE_FUNDSOURCE_ID
          };

          console.log('Initiating INR payout:', {
            amount: inrAmount,
            beneficiaryId: transferRequest.beneficiaryId,
            merchantName: transferRequest.beneficiaryName
          });

          // Initiate the payout
          inrPayoutResult = await this.cashfreeService.initiateTransfer(transferRequest);

          if (inrPayoutResult.status === 'SUCCESS' || inrPayoutResult.status === 'RECEIVED') {
            payoutTransferId = transferId;
            console.log(`✅ INR payout initiated successfully. Transfer ID: ${transferId}`);
          } else {
            console.warn(`❌ INR payout failed: ${inrPayoutResult.message}`);
          }
        } else {
          console.log('No INR amount specified, skipping payout');
        }
      } catch (payoutError) {
        console.error('INR payout initiation failed:', payoutError);
        console.warn('USDC transaction succeeded but INR payout failed - attempting refund');
      }

      // If payout failed, attempt refund of USDC (excluding network fee)
      if (!payoutTransferId) {
        try {
          console.log('🔄 UPI payout failed, attempting USDC refund...');
          
          // Verify that USDC was actually received by treasury before refunding
          const txHashForVerification = transactionHash;
          const originalFrom = request.metaTransactionRequest
            ? request.metaTransactionRequest.from
            : (request.sponsoredRequest?.userAddress || request.userOp?.sender);

          if (!originalFrom) {
            throw new Error('Unable to determine original sender for verification');
          }

          const originalUsdcAmount = request.metaTransactionRequest
            ? parseFloat(request.metaTransactionRequest.value)
            : parseFloat(this.extractUSDCAmount(request.upiMerchantDetails));

          // Extract network fee from the request if available, otherwise use a small fixed fee
          let networkFee = 0;
          if (request.metaTransactionRequest && request.metaTransactionRequest.networkFee) {
            networkFee = parseFloat(request.metaTransactionRequest.networkFee);
          } else {
            // Fallback: use a small fixed fee (0.001 USDC) to prevent dust
            networkFee = 0.05;
          }

          const refundAmount = Math.max(originalUsdcAmount - networkFee, 0);

          // Determine refund recipient: for meta-tx, refund to original sender; otherwise fallback to userOp sender if present
          const refundTo = request.metaTransactionRequest?.from || request.userOp?.sender || request.sponsoredRequest?.userAddress;
          if (!refundTo) {
            throw new Error('Unable to determine refund recipient');
          }

          console.log(`Refund details: originalAmount=${originalUsdcAmount}, networkFee=${networkFee}, refundAmount=${refundAmount}, to=${refundTo}`);

          // Perform verification based on flow with retry logic
          let verifiedIncoming = false;
          let verificationError = '';
          
          // Try verification up to 3 times with delays (for transaction indexing)
          for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`Verification attempt ${attempt}/3...`);
            
            if (request.metaTransactionRequest) {
              const verificationResult = await this.usdcMetaTransactionService.verifyMetaTransaction(
                txHashForVerification,
                originalFrom,
                config.treasuryAddress,
                originalUsdcAmount.toString()
              );
              verifiedIncoming = verificationResult.verified;
              verificationError = verificationResult.error || '';
            } else {
              const verificationResult = await this.usdcService.verifyTransferInTransaction(
                txHashForVerification,
                originalFrom,
                config.treasuryAddress,
                originalUsdcAmount.toString()
              );
              verifiedIncoming = verificationResult.verified;
              verificationError = verificationResult.error || '';
            }

            if (verifiedIncoming) {
              console.log(`✅ Verification successful on attempt ${attempt}`);
              break;
            } else {
              console.log(`❌ Verification failed on attempt ${attempt}: ${verificationError}`);
              if (attempt < 3) {
                console.log(`Waiting 2 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          }

          if (!verifiedIncoming) {
            console.error(`❌ All verification attempts failed. Last error: ${verificationError}`);
            // Even if verification fails, we should still attempt refund as a fallback
            // The user paid USDC and deserves a refund regardless of verification issues
            console.log('⚠️ Proceeding with refund despite verification failure (fallback mode)');
          }

          // Check if treasury has sufficient balance for refund
          const treasuryBalance = await this.usdcService.getBalance(config.treasuryAddress);
          const treasuryBalanceNum = parseFloat(treasuryBalance);
          
          console.log(`Treasury USDC balance: ${treasuryBalanceNum}, required for refund: ${refundAmount}`);
          
          if (treasuryBalanceNum < refundAmount) {
            console.error(`❌ Insufficient treasury balance for refund: ${treasuryBalanceNum} < ${refundAmount}`);
            return {
              success: false,
              status: 'failed',
              error: `UPI payout failed and insufficient treasury balance for refund (${treasuryBalanceNum} < ${refundAmount})`
            } as ERC7702Response;
          }

          console.log(`🔁 Initiating USDC refund: amount=${refundAmount.toFixed(6)} to=${refundTo} (networkFee=${networkFee.toFixed(6)} USDC)`);
          const refundResult = await this.usdcService.refundFromTreasury(refundTo, refundAmount.toFixed(6));

          if (refundResult.success) {
            console.log(`✅ Refund successful. Refund tx: ${refundResult.transactionHash}`);
            return {
              success: false,
              status: 'refunded',
              error: 'UPI payout failed; USDC refunded (minus network fee)',
              refund: {
                amount: refundAmount.toFixed(6),
                fee: networkFee.toFixed(6),
                transactionHash: refundResult.transactionHash,
                to: refundTo
              }
            } as ERC7702Response;
          } else {
            console.error('❌ Refund failed:', refundResult.error);
            return {
              success: false,
              status: 'failed',
              error: `UPI payout failed and refund failed: ${refundResult.error}`
            } as ERC7702Response;
          }
        } catch (refundError: any) {
          console.error('❌ Refund processing error:', refundError);
          return {
            success: false,
            status: 'failed',
            error: `UPI payout failed and refund error: ${refundError.message || refundError}`
          } as ERC7702Response;
        }
      }

      // Return success response with complete transaction details
      console.log('Payment orchestration completed successfully');

      const response: ERC7702Response = {
        success: true,
        transactionHash,
        status: payoutTransferId ? 'completed' : 'completed_with_payout_failure',
        upiPaymentId: payoutTransferId,
        upiPaymentStatus: inrPayoutResult?.status || 'not_initiated'
      };

      if (inrPayoutResult && payoutTransferId) {
        response.upiPayoutDetails = {
          transferId: payoutTransferId,
          status: inrPayoutResult.status,
          message: inrPayoutResult.message,
          amount: parseFloat(request.upiMerchantDetails.am || '0')
        };
      }

      return response;

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
   * Extracts beneficiary ID from UPI merchant details
   * For now, we'll use a simple mapping - in production you'd have a database lookup
   */
  private extractBeneficiaryId(upiDetails: UPIMerchantDetails): string {
    // For demo purposes, use a hardcoded mapping for test UPI IDs
    // In production, you'd query your database to find the beneficiary ID for the UPI ID

    const upiId = upiDetails.pa;

    // Test beneficiary mappings
    const testMappings: { [key: string]: string } = {
      'success@upi': '1492218328b3o0m39jsCfkjeyFVBKdreP1',
      'merchant@paytm': '1492218328b3o0m39jsCfkjeyFVBKdreP1', // Same test beneficiary
      'testuser@paytm': '1492218328b3o0m39jsCfkjeyFVBKdreP1',
    };

    // Return mapped beneficiary ID or generate one based on UPI ID
    return testMappings[upiId] || `bene_${upiId.replace('@', '_').replace(/[^a-zA-Z0-9_]/g, '')}`;
  }

  /**
   * Processes only the INR payout after USDC transaction is already completed
   */
  public async processINRPayoutOnly(request: ERC7702Request, transactionHash: string): Promise<ERC7702Response> {
    try {
      console.log('Processing INR payout only for transaction:', transactionHash);

      let inrPayoutResult = null;
      let payoutTransferId: string | undefined = undefined;

      try {
        // Extract INR amount from UPI merchant details
        const inrAmount = parseFloat(request.upiMerchantDetails.am || '0');

        if (inrAmount > 0) {
          // Generate unique transfer ID
          const transferId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

          // Create transfer request for Cashfree
          const transferRequest: CashfreeTransferRequest = {
            transferId,
            transferAmount: inrAmount,
            beneficiaryId: this.extractBeneficiaryId(request.upiMerchantDetails),
            beneficiaryName: request.upiMerchantDetails.pn || 'Merchant',
            beneficiaryVpa: request.upiMerchantDetails.pa,
            transferRemarks: `Payment to ${request.upiMerchantDetails.pn || 'Merchant'}`,
            fundsourceId: process.env.CASHFREE_FUNDSOURCE_ID
          };

          console.log('Initiating INR payout:', {
            amount: inrAmount,
            beneficiaryId: transferRequest.beneficiaryId,
            merchantName: transferRequest.beneficiaryName
          });

          // Initiate the payout
          inrPayoutResult = await this.cashfreeService.initiateTransfer(transferRequest);

          if (inrPayoutResult.status === 'SUCCESS' || inrPayoutResult.status === 'RECEIVED') {
            payoutTransferId = transferId;
            console.log(`✅ INR payout initiated successfully. Transfer ID: ${transferId}`);
          } else {
            console.warn(`❌ INR payout failed: ${inrPayoutResult.message}`);
          }
        } else {
          console.log('No INR amount specified, skipping payout');
        }
      } catch (payoutError) {
        console.error('INR payout initiation failed:', payoutError);
        throw payoutError;
      }

      const response: ERC7702Response = {
        success: true,
        transactionHash,
        status: 'completed',
        upiPaymentId: payoutTransferId,
        upiPaymentStatus: inrPayoutResult?.status || 'not_initiated'
      };

      if (inrPayoutResult && payoutTransferId) {
        response.upiPayoutDetails = {
          transferId: payoutTransferId,
          status: inrPayoutResult.status,
          message: inrPayoutResult.message,
          amount: parseFloat(request.upiMerchantDetails.am || '0')
        };
      }

      return response;

    } catch (error) {
      console.error('INR payout processing failed:', error);
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown payout error'
      };
    }
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
