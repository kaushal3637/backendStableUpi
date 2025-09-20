import { CashfreeService } from './cashfreeService';
import { UPIMerchantDetails } from '../types';

export interface AutoBeneficiaryResult {
  success: boolean;
  beneficiaryId?: string;
  customerId?: string;
  error?: string;
  isNewBeneficiary?: boolean;
  originalUpiId?: string;
  processingUpiId?: string;
  isFailureMode?: boolean;
}

export class AutoBeneficiaryService {
  private cashfreeService: CashfreeService;

  constructor() {
    this.cashfreeService = new CashfreeService();
  }

  /**
   * Automatically creates a beneficiary from UPI QR data
   * Uses success@upi for successful transactions unless failure@upi is defined
   * @param upiDetails - UPI details from scanned QR code
   * @returns AutoBeneficiaryResult with beneficiary information
   */
  async createBeneficiaryFromUPI(upiDetails: UPIMerchantDetails): Promise<AutoBeneficiaryResult> {
    try {
      console.log('🔄 AutoBeneficiaryService: Creating beneficiary with success@upi logic:', upiDetails);

      const originalUpiId = upiDetails.pa;
      const merchantName = upiDetails.pn || 'Unknown Merchant';

      if (!originalUpiId) {
        return {
          success: false,
          error: 'UPI ID is required to create beneficiary'
        };
      }

      // Determine which UPI ID to use for Cashfree processing
      let processingUpiId: string;
      let isFailureMode = false;

      // Check if this is a failure UPI ID
      if (originalUpiId === 'failure@upi') {
        processingUpiId = 'failure@upi';
        isFailureMode = true;
        console.log('⚠️ Using failure@upi for testing failure scenarios');
      } else {
        // Use success@upi for all other cases to ensure successful transactions
        processingUpiId = 'success@upi';
        console.log('✅ Using success@upi for successful transaction simulation');
      }

      console.log('📊 UPI ID mapping:', {
        originalUpiId,
        processingUpiId,
        isFailureMode,
        merchantName
      });

      // Generate unique beneficiary ID based on processing UPI ID
      const beneficiaryId = this.generateBeneficiaryId(processingUpiId);
      const customerId = `CUST_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      console.log('🆕 Creating beneficiary with success@upi logic:', {
        originalUpiId,
        processingUpiId,
        merchantName,
        beneficiaryId,
        customerId,
        isFailureMode
      });

      // Generate unique bank details
      const bankAccountNumber = this.generateBankAccountNumber();
      const ifscCode = this.generateRandomIFSC();

      console.log('🏦 Generated unique bank details:', {
        accountNumber: bankAccountNumber,
        ifsc: ifscCode
      });

      // Create beneficiary in Cashfree using processing UPI ID
      const cashfreeBeneficiary = {
        beneId: beneficiaryId,
        name: merchantName, // Use original merchant name from QR
        email: `${processingUpiId.replace('@', '_')}@auto-generated.com`,
        phone: '', // No phone available from QR
        vpa: processingUpiId, // Use processing UPI ID for Cashfree
        bankAccount: {
          accountNumber: bankAccountNumber.toString(),
          ifsc: ifscCode,
          accountHolderName: merchantName // Use original merchant name
        }
      };

      // Add beneficiary to Cashfree
      const cashfreeResult = await this.cashfreeService.addBeneficiary(cashfreeBeneficiary);

      if (cashfreeResult.status !== 'SUCCESS') {
        console.error('❌ Failed to add beneficiary to Cashfree:', cashfreeResult.message);
        return {
          success: false,
          error: `Failed to add beneficiary to Cashfree: ${cashfreeResult.message}`
        };
      }

      console.log('✅ Beneficiary created successfully in Cashfree:', {
        beneficiaryId,
        originalUpiId,
        processingUpiId,
        merchantName,
        bankAccountNumber: bankAccountNumber.toString(),
        ifsc: ifscCode,
        isFailureMode
      });

      return {
        success: true,
        beneficiaryId: beneficiaryId,
        customerId: customerId,
        isNewBeneficiary: true,
        // Include original UPI data for reference
        originalUpiId: originalUpiId,
        processingUpiId: processingUpiId,
        isFailureMode: isFailureMode
      };

    } catch (error) {
      console.error('❌ AutoBeneficiaryService error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error creating beneficiary'
      };
    }
  }

  /**
   * Generates a unique beneficiary ID from UPI ID
   * @param upiId - UPI ID from QR code
   * @returns Generated beneficiary ID
   */
  private generateBeneficiaryId(upiId: string): string {
    // Clean UPI ID and create a unique identifier
    const cleanUpiId = upiId.replace('@', '_').replace(/[^a-zA-Z0-9_]/g, '');
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    
    return `auto_${cleanUpiId}_${timestamp}_${random}`;
  }

  /**
   * Generates a unique 15-digit bank account number
   * @returns 15-digit account number as string
   */
  private generateBankAccountNumber(): string {
    // Generate 15-digit random number with timestamp for uniqueness
    const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
    const random = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'); // 9 random digits
    const accountNumber = timestamp + random; // 6 + 9 = 15 digits
    
    return accountNumber;
  }

  /**
   * Generates a random IFSC code from the specified ranges
   * @returns Random IFSC code
   */
  private generateRandomIFSC(): string {
    const ifscCodes = [
      'ICIC0000001', 'ICIC0000002', 'ICIC0000003', 'ICIC0000004', 'ICIC0000005',
      'ICIC0000006', 'ICIC0000007', 'ICIC0000008', 'ICIC0000009',
      'SBIN0000001', 'SBIN0000002', 'SBIN0000003', 'SBIN0000004', 'SBIN0000005',
      'SBIN0000006', 'SBIN0000007', 'SBIN0000008', 'SBIN0000009',
      'HDFC0000001', 'HDFC0000002', 'HDFC0000003', 'HDFC0000004', 'HDFC0000005',
      'HDFC0000006', 'HDFC0000007', 'HDFC0000008', 'HDFC0000009'
    ];
    
    const randomIndex = Math.floor(Math.random() * ifscCodes.length);
    return ifscCodes[randomIndex];
  }

}
