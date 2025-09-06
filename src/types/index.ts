// ERC-7702 User Operation types
export interface UserOperation {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  signature: string;
}

export interface ERC7702Request {
  userOp: UserOperation;
  upiMerchantDetails: UPIMerchantDetails;
  chainId: number;
}

export interface ERC7702Response {
  success: boolean;
  transactionHash?: string;
  upiPaymentId?: string;
  error?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

// UPI Payment types
export interface UPIMerchantDetails {
  pa: string; // Payee VPA/UPI ID
  pn?: string; // Payee name
  am?: string; // Transaction amount
  cu?: string; // Currency code
  mc?: string; // Merchant code
  tr?: string; // Transaction reference
}

export interface UPIPaymentRequest {
  merchantDetails: UPIMerchantDetails;
  amount: string;
  currency: string;
  transactionId: string;
}

export interface UPIPaymentResponse {
  success: boolean;
  paymentId?: string;
  status: 'initiated' | 'completed' | 'failed';
  error?: string;
}

// USDC Transfer types
export interface USDCTansferRequest {
  from: string;
  to: string;
  amount: string;
  chainId: number;
}

export interface USDCTansferResponse {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

// API Response types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Configuration types
export interface BlockchainConfig {
  rpcUrl: string;
  chainId: number;
  usdcContractAddress: string;
  entryPointAddress: string;
}

export interface UPIConfig {
  apiEndpoint: string;
  apiKey: string;
  merchantId: string;
}
