import axios from 'axios';
import { UPIPaymentRequest, UPIPaymentResponse, UPIMerchantDetails } from '../types';
import { config } from './config';

export class UPIService {
  private apiEndpoint: string;
  private apiKey: string;
  private merchantId: string;

  constructor() {
    this.apiEndpoint = config.upiConfig.apiEndpoint;
    this.apiKey = config.upiConfig.apiKey;
    this.merchantId = config.upiConfig.merchantId;
  }

  /**
   * Initiates a UPI payment
   */
  public async initiatePayment(request: UPIPaymentRequest): Promise<UPIPaymentResponse> {
    try {
      // Validate merchant details
      this.validateMerchantDetails(request.merchantDetails);

      // Prepare payment payload
      const payload = {
        merchantId: this.merchantId,
        payeeAddress: request.merchantDetails.pa,
        payeeName: request.merchantDetails.pn,
        amount: request.amount,
        currency: request.currency,
        transactionId: request.transactionId,
        merchantCode: request.merchantDetails.mc,
        transactionRef: request.merchantDetails.tr,
      };

      // Make API call to UPI provider
      const response = await axios.post(
        `${this.apiEndpoint}/payments/initiate`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 second timeout
        }
      );

      if (response.status === 200 && response.data.success) {
        return {
          success: true,
          paymentId: response.data.paymentId,
          status: 'initiated'
        };
      } else {
        throw new Error(response.data.message || 'UPI payment initiation failed');
      }

    } catch (error) {
      console.error('UPI payment initiation failed:', error);

      if (axios.isAxiosError(error)) {
        return {
          success: false,
          status: 'failed',
          error: error.response?.data?.message || error.message
        };
      }

      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Checks UPI payment status
   */
  public async checkPaymentStatus(paymentId: string): Promise<UPIPaymentResponse> {
    try {
      const response = await axios.get(
        `${this.apiEndpoint}/payments/${paymentId}/status`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        }
      );

      if (response.status === 200) {
        return {
          success: true,
          paymentId,
          status: response.data.status
        };
      } else {
        throw new Error('Failed to check payment status');
      }

    } catch (error) {
      console.error('Payment status check failed:', error);
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Validates UPI merchant details
   */
  private validateMerchantDetails(details: UPIMerchantDetails): void {
    if (!details.pa || !details.pa.includes('@')) {
      throw new Error('Invalid payee UPI address');
    }

    if (details.am && parseFloat(details.am) <= 0) {
      throw new Error('Invalid payment amount');
    }

    if (details.cu && details.cu !== 'INR') {
      throw new Error('Only INR currency is supported for UPI payments');
    }
  }

  /**
   * Formats UPI payment request for logging
   */
  public formatPaymentRequest(request: UPIPaymentRequest): string {
    return `
UPI Payment Request:
- Payee: ${request.merchantDetails.pn || 'Unknown'} (${request.merchantDetails.pa})
- Amount: ${request.amount} ${request.currency}
- Transaction ID: ${request.transactionId}
- Merchant Code: ${request.merchantDetails.mc || 'N/A'}
    `.trim();
  }
}
