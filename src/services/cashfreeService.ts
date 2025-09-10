import axios from 'axios';
import { config } from './config';

export interface CashfreeBeneficiary {
  beneId: string;
  name: string;
  email?: string;
  phone?: string;
  bankAccount?: {
    accountNumber: string;
    ifsc: string;
    accountHolderName: string;
  };
  vpa?: string;
  address1?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface CashfreeTransferRequest {
  transferId: string;
  transferAmount: number;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryVpa: string;
  transferRemarks?: string;
  fundsourceId?: string;
}

export interface CashfreeTransferResponse {
  status: string;
  message: string;
  data?: any;
}

export interface CashfreeTransferStatusResponse {
  status: string;
  message?: string;
  data?: any;
}

export interface CashfreeBeneficiaryResponse {
  status: string;
  message: string;
  data: {
    beneficiary_id: string;
    beneficiary_name: string;
    beneficiary_status: string;
    added_on: string;
  };
}

export interface CashfreeBeneficiaryDetailsResponse {
  beneficiary_id: string;
  beneficiary_name: string;
  beneficiary_email?: string;
  beneficiary_phone?: string;
  beneficiary_instrument_details: {
    vpa?: string;
    bank_account_number?: string;
    bank_ifsc?: string;
  };
}

export class CashfreeService {
  private config: any;

  constructor() {
    // Use environment variables for Cashfree configuration
    this.config = {
      APP_ID: process.env.CASHFREE_APP_ID || '',
      SECRET_KEY: process.env.CASHFREE_SECRET_KEY || '',
      CLIENT_ID: process.env.CASHFREE_CLIENT_ID || '',
      CLIENT_SECRET: process.env.CASHFREE_CLIENT_SECRET || '',
      BASE_URL: process.env.NODE_ENV === 'production'
        ? 'https://api.cashfree.com'
        : 'https://sandbox.cashfree.com',
      FUNDSOURCE_ID: process.env.CASHFREE_FUNDSOURCE_ID || 'CASHFREE_DEFAULT'
    };
  }

  /**
   * Get authorization token from Cashfree V2 API
   */
  private async getAuthToken(): Promise<string> {
    try {
      console.log("🔐 Backend: Attempting Cashfree V2 authentication...");

      const response = await axios.post(
        `${this.config.BASE_URL}/payout/v1/authorize`,
        {},
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-version': '2024-01-01',
            'x-client-id': this.config.CLIENT_ID,
            'x-client-secret': this.config.CLIENT_SECRET,
          },
        }
      );

      console.log("📊 Auth Response Status:", response.status);

      if (response.status !== 200) {
        throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
      }

      const data = response.data;

      if (data.status !== "SUCCESS" || !data.data?.token) {
        console.error("❌ Cashfree auth failed:", data.message || "Invalid response");
        throw new Error(`Auth failed: ${data.message || "Invalid response"}`);
      }

      console.log("✅ Cashfree V2 authentication successful!");
      return data.data.token;
    } catch (error: any) {
      console.error("💥 Cashfree auth error:", error.message);
      throw new Error(`Failed to authenticate with Cashfree: ${error.message}`);
    }
  }

  /**
   * Add a beneficiary for payouts
   */
  async addBeneficiary(beneficiary: CashfreeBeneficiary): Promise<CashfreeBeneficiaryResponse> {
    try {
      console.log("🔄 Backend: Adding beneficiary to Cashfree V2 API...");

      const requestBody = {
        beneficiary_id: beneficiary.beneId,
        beneficiary_name: beneficiary.name,
        beneficiary_instrument_details: {
          bank_account_number: beneficiary.bankAccount?.accountNumber || "1234567890",
          bank_ifsc: beneficiary.bankAccount?.ifsc || "HDFC0000001",
          ...(beneficiary.vpa && { vpa: beneficiary.vpa }),
        },
      };

      console.log("📤 Creating beneficiary with V2 format:", JSON.stringify(requestBody, null, 2));

      const response = await axios.post(
        `${this.config.BASE_URL}/payout/beneficiary`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-version': '2024-01-01',
            'x-client-id': this.config.CLIENT_ID,
            'x-client-secret': this.config.CLIENT_SECRET,
          },
        }
      );

      if (response.status !== 200) {
        const errorData = response.data;
        console.error("❌ Beneficiary creation failed:", errorData);
        throw new Error(`Add beneficiary failed: ${errorData.message || response.statusText}`);
      }

      const data = response.data;
      console.log("✅ Beneficiary created successfully:", data);

      return {
        status: "SUCCESS",
        message: "Beneficiary added successfully",
        data: {
          beneficiary_id: data.beneficiary_id,
          beneficiary_name: data.beneficiary_name,
          beneficiary_status: data.beneficiary_status,
          added_on: data.added_on,
        },
      };
    } catch (error: any) {
      console.error("Add beneficiary error:", error.message);
      throw new Error(`Failed to add beneficiary: ${error.message}`);
    }
  }

  /**
   * Initiate a payout transfer
   */
  async initiateTransfer(transferRequest: CashfreeTransferRequest): Promise<CashfreeTransferResponse> {
    try {
      console.log("💸 Backend: Initiating UPI transfer via Cashfree API...");

      const requestBody = {
        transfer_id: transferRequest.transferId,
        transfer_amount: transferRequest.transferAmount,
        beneficiary_details: {
          beneficiary_id: transferRequest.beneficiaryId,
          beneficiary_name: transferRequest.beneficiaryName,
          beneficiary_instrument_details: {
            vpa: transferRequest.beneficiaryVpa
          }
        },
        transfer_mode: "upi",
        transfer_remarks: transferRequest.transferRemarks || "UPI Payment",
        fundsource_id: transferRequest.fundsourceId || this.config.FUNDSOURCE_ID
      };

      console.log("📤 Transfer request:", JSON.stringify(requestBody, null, 2));

      const response = await axios.post(`${this.config.BASE_URL}/payout/transfers`, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-version': '2024-01-01',
          'x-client-id': this.config.CLIENT_ID,
          'x-client-secret': this.config.CLIENT_SECRET,
        },
      });

      if (response.status !== 200) {
        const errorText = response.data;
        console.error("❌ Transfer failed:", errorText);
        throw new Error(`Transfer failed: ${errorText.message || response.statusText}`);
      }

      const data = response.data;
      console.log("✅ Transfer initiated successfully:", data);
      console.log("📊 Transfer status received:", data.status);
      console.log("📊 Transfer status code:", data.status_code);

      return {
        status: data.status || "SUCCESS",
        message: data.message || "Transfer initiated successfully",
        data: data.data || data,
      };
    } catch (error: any) {
      console.error("Transfer error:", error.message);
      throw new Error(`Failed to initiate transfer: ${error.message}`);
    }
  }

  /**
   * Get transfer status
   */
  async getTransferStatus(transferId: string): Promise<CashfreeTransferStatusResponse> {
    try {
      console.log("📊 Backend: Getting transfer status via V2 API...");

      const response = await axios.get(
        `${this.config.BASE_URL}/payout/transfers/${transferId}`,
        {
          headers: {
            'x-api-version': '2024-01-01',
            'x-client-id': this.config.CLIENT_ID,
            'x-client-secret': this.config.CLIENT_SECRET,
          },
        }
      );

      if (response.status !== 200) {
        const errorData = response.data;
        console.error("❌ Get status failed:", errorData);
        throw new Error(`Get status failed: ${errorData.message || response.statusText}`);
      }

      const data = response.data;
      console.log("✅ Transfer status retrieved:", data);
      return data;
    } catch (error: any) {
      console.error("Get transfer status error:", error.message);
      throw new Error(`Failed to get transfer status: ${error.message}`);
    }
  }

  /**
   * Get beneficiary details
   */
  async getBeneficiary(beneId: string): Promise<CashfreeBeneficiaryDetailsResponse> {
    try {
      console.log("👤 Backend: Getting beneficiary details via V2 API...");

      const response = await axios.get(
        `${this.config.BASE_URL}/payout/beneficiary?beneficiary_id=${beneId}`,
        {
          headers: {
            'x-api-version': '2024-01-01',
            'x-client-id': this.config.CLIENT_ID,
            'x-client-secret': this.config.CLIENT_SECRET,
          },
        }
      );

      if (response.status !== 200) {
        const errorData = response.data;
        console.error("❌ Get beneficiary failed:", errorData);
        throw new Error(`Get beneficiary failed: ${errorData.message || response.statusText}`);
      }

      const data = response.data;
      console.log("✅ Beneficiary details retrieved:", data);
      return data;
    } catch (error: any) {
      console.error("Get beneficiary error:", error.message);
      throw new Error(`Failed to get beneficiary: ${error.message}`);
    }
  }
}
