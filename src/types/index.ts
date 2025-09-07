// EIP-7702 Authorization types
export interface EIP7702Authorization {
  chainId: number;
  address: string; // Delegation contract address
  nonce: string;
  yParity: number;
  r: string;
  s: string;
}

// EIP-7702 Call structure
export interface EIP7702Call {
  to: string;
  value: string;
  data: string;
}

// EIP-7702 Sponsored Transaction Request
export interface EIP7702SponsoredRequest {
  userAddress: string; // EOA address
  calls: EIP7702Call[];
  authorization: EIP7702Authorization;
  upiMerchantDetails: UPIMerchantDetails;
  chainId: number;
}

// Legacy UserOperation (keep for compatibility)
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
  userOp?: UserOperation; // Optional for legacy support
  sponsoredRequest?: EIP7702SponsoredRequest; // New sponsored transaction
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
}

export interface UPIConfig {
  apiEndpoint: string;
  apiKey: string;
  merchantId: string;
}
