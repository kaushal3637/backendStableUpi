import { CashfreeService } from './cashfreeService';
import { UPIMerchantDetails } from '../types';

export interface AutoBeneficiaryResult {
  success: boolean;
  beneficiaryId?: string;
  customerId?: string;
  error?: string;
  isNewBeneficiary?: boolean;
}

export class AutoBeneficiaryService {
  private cashfreeService: CashfreeService;

  constructor() {
    this.cashfreeService = new CashfreeService();
  }

  /**
   * Automatically creates a beneficiary from UPI QR data (always creates new, skips DB check)
   * @param upiDetails - UPI details from scanned QR code
   * @returns AutoBeneficiaryResult with beneficiary information
   */
  async createBeneficiaryFromUPI(upiDetails: UPIMerchantDetails): Promise<AutoBeneficiaryResult> {
    try {
      console.log('🔄 AutoBeneficiaryService: Creating fresh beneficiary from UPI details:', upiDetails);

      const upiId = upiDetails.pa;
      const merchantName = upiDetails.pn || 'Unknown Merchant';

      if (!upiId) {
        return {
          success: false,
          error: 'UPI ID is required to create beneficiary'
        };
      }

      // Generate unique beneficiary ID (always create new)
      const beneficiaryId = this.generateBeneficiaryId(upiId);
      const customerId = `CUST_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      console.log('🆕 Creating fresh beneficiary (skipping DB check):', {
        upiId,
        merchantName,
        beneficiaryId,
        customerId
      });

      // Generate unique bank details
      const bankAccountNumber = this.generateBankAccountNumber();
      const ifscCode = this.generateRandomIFSC();

      console.log('🏦 Generated unique bank details:', {
        accountNumber: bankAccountNumber,
        ifsc: ifscCode
      });

      // Create beneficiary in Cashfree
      const cashfreeBeneficiary = {
        beneId: beneficiaryId,
        name: merchantName,
        email: `${upiId.replace('@', '_')}@auto-generated.com`,
        phone: '', // No phone available from QR
        vpa: upiId,
        bankAccount: {
          accountNumber: bankAccountNumber.toString(),
          ifsc: ifscCode,
          accountHolderName: merchantName
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

      console.log('✅ Fresh beneficiary created successfully in Cashfree:', {
        beneficiaryId,
        upiId,
        merchantName,
        bankAccountNumber: bankAccountNumber.toString(),
        ifsc: ifscCode
      });

      return {
        success: true,
        beneficiaryId: beneficiaryId,
        customerId: customerId,
        isNewBeneficiary: true
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
