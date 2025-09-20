import { ethers } from 'ethers';
import { config } from './config';

export interface USDCMetaTransactionRequest {
  from: string;
  to: string;
  value: string; // Amount in USDC (decimal format)
  validAfter: number; // timestamp
  validBefore: number; // timestamp
  nonce: string; // hex string
  signature: {
    v: number;
    r: string;
    s: string;
  };
  chainId: number;
  networkFee?: string; // Network fee for refund calculations
}

export interface USDCMetaTransactionResponse {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

export interface PrepareMetaTransactionRequest {
  from: string;
  to: string;
  value: string;
  validAfter?: number;
  validBefore?: number;
  chainId: number;
}

export interface PrepareMetaTransactionResponse {
  nonce: string;
  typedData: {
    domain: any;
    types: any;
    message: any;
  };
  validAfter: number;
  validBefore: number;
}

export class USDCMetaTransactionService {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private usdcContract: ethers.Contract;
  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
    const blockchainConfig = config.getBlockchainConfig(chainId);
    this.provider = new ethers.JsonRpcProvider(blockchainConfig.rpcUrl);
    this.signer = new ethers.Wallet(config.backendPrivateKey, this.provider);

    // Extended USDC Contract ABI with meta transaction functions
    const usdcAbi = [
      'function transfer(address to, uint256 amount) external returns (bool)',
      'function balanceOf(address account) external view returns (uint256)',
      'function decimals() external view returns (uint8)',
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function nonces(address owner) external view returns (uint256)',
      'function DOMAIN_SEPARATOR() external view returns (bytes32)',
      'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
      'function authorizationState(address authorizer, bytes32 nonce) external view returns (bool)',
      'function name() external view returns (string)',
      'function version() external view returns (string)'
    ];

    this.usdcContract = new ethers.Contract(
      blockchainConfig.usdcContractAddress,
      usdcAbi,
      this.signer
    );
  }

  /**
   * Prepares the typed data for a USDC meta transaction signature
   */
  public async prepareMetaTransaction(request: PrepareMetaTransactionRequest): Promise<PrepareMetaTransactionResponse> {
    try {
      // Validate addresses
      if (!ethers.isAddress(request.from) || !ethers.isAddress(request.to)) {
        throw new Error('Invalid address format');
      }

      // Generate a unique nonce
      const nonce = ethers.keccak256(ethers.toUtf8Bytes(`${request.from}-${Date.now()}-${Math.random()}`));

      // Check if nonce is already used
      const isUsed = await this.usdcContract.authorizationState(request.from, nonce);
      if (isUsed) {
        throw new Error('Nonce already used');
      }

      // Set default validity period (1 hour from now)
      const validAfter = request.validAfter || Math.floor(Date.now() / 1000);
      const validBefore = request.validBefore || Math.floor(Date.now() / 1000) + 3600; // 1 hour

      // Get domain separator and contract details
      const domainSeparator = await this.usdcContract.DOMAIN_SEPARATOR();
      const name = await this.usdcContract.name();
      const version = await this.usdcContract.version();

      // Convert amount to wei (USDC has 6 decimals)
      const value = ethers.parseUnits(request.value, 6);

      // Create EIP-712 typed data for transferWithAuthorization
      const domain = {
        name: name,
        version: version,
        chainId: this.chainId,
        verifyingContract: await this.usdcContract.getAddress()
      };

      const types = {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' }
        ]
      };

      const message = {
        from: request.from,
        to: request.to,
        value: value.toString(),
        validAfter: validAfter,
        validBefore: validBefore,
        nonce: nonce
      };

      return {
        nonce: nonce,
        typedData: {
          domain,
          types,
          message
        },
        validAfter,
        validBefore
      };

    } catch (error) {
      console.error('Error preparing meta transaction:', error);
      throw new Error(`Failed to prepare meta transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Executes a USDC meta transaction using transferWithAuthorization
   */
  public async executeMetaTransaction(request: USDCMetaTransactionRequest): Promise<USDCMetaTransactionResponse> {
    try {
      // Validate addresses
      if (!ethers.isAddress(request.from) || !ethers.isAddress(request.to)) {
        throw new Error('Invalid address format');
      }

      // Convert amount to wei
      const value = ethers.parseUnits(request.value, 6);

      // Check if the user has sufficient balance
      const balance = await this.usdcContract.balanceOf(request.from);
      if (balance < value) {
        const balanceFmt = ethers.formatUnits(balance, 6);
        throw new Error(`Insufficient USDC balance. Has ${balanceFmt}, needs ${request.value}`);
      }

      // Check if nonce is already used
      const isUsed = await this.usdcContract.authorizationState(request.from, request.nonce);
      if (isUsed) {
        throw new Error('Authorization nonce already used');
      }

      // Validate signature components
      if (!request.signature.r || !request.signature.s || request.signature.v < 27 || request.signature.v > 28) {
        throw new Error('Invalid signature format');
      }

      console.log('Executing USDC meta transaction:', {
        from: request.from,
        to: request.to,
        value: request.value,
        nonce: request.nonce
      });

      // Execute transferWithAuthorization
      const tx = await this.usdcContract.transferWithAuthorization(
        request.from,
        request.to,
        value,
        request.validAfter,
        request.validBefore,
        request.nonce,
        request.signature.v,
        request.signature.r,
        request.signature.s,
        {
          gasLimit: 200000 // Set reasonable gas limit
        }
      );

      // Wait for confirmation
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('USDC meta transaction failed');
      }

      console.log(`USDC meta transaction successful: ${receipt.hash}`);

      return {
        success: true,
        transactionHash: receipt.hash
      };

    } catch (error) {
      console.error('USDC meta transaction failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Verifies if a USDC meta transaction occurred by checking transaction logs
   */
  public async verifyMetaTransaction(txHash: string, from: string, to: string, expectedAmount: string): Promise<{
    verified: boolean;
    actualAmount?: string;
    error?: string;
  }> {
    try {
      console.log(`Verifying meta transaction: txHash=${txHash}, from=${from}, to=${to}, expectedAmount=${expectedAmount}`);
      
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { verified: false, error: 'Transaction receipt not found' };
      }

      if (receipt.status !== 1) {
        return { verified: false, error: 'Transaction failed' };
      }

      // USDC Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
      const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      
      // Look for Transfer events from USDC contract
      const usdcContractAddress = await this.usdcContract.getAddress();
      console.log(`Looking for USDC transfers in contract: ${usdcContractAddress}`);
      
      // Normalize addresses for comparison
      const normalizedFrom = ethers.getAddress(from);
      const normalizedTo = ethers.getAddress(to);
      const normalizedContract = ethers.getAddress(usdcContractAddress);
      
      console.log(`Normalized addresses - from: ${normalizedFrom}, to: ${normalizedTo}, contract: ${normalizedContract}`);
      
      const transferLogs = receipt.logs.filter(log => {
        const isUsdcContract = log.address.toLowerCase() === normalizedContract.toLowerCase();
        const isTransferEvent = log.topics[0] === transferEventSignature;
        
        if (isUsdcContract && isTransferEvent) {
          const logFrom = ethers.getAddress('0x' + log.topics[1].slice(26));
          const logTo = ethers.getAddress('0x' + log.topics[2].slice(26));
          const matchesFrom = logFrom.toLowerCase() === normalizedFrom.toLowerCase();
          const matchesTo = logTo.toLowerCase() === normalizedTo.toLowerCase();
          
          console.log(`Found USDC transfer log: from=${logFrom}, to=${logTo}, matchesFrom=${matchesFrom}, matchesTo=${matchesTo}`);
          return matchesFrom && matchesTo;
        }
        return false;
      });

      console.log(`Found ${transferLogs.length} matching transfer logs`);

      if (transferLogs.length === 0) {
        // Debug: show all USDC transfer events
        const allUsdcLogs = receipt.logs.filter(log => 
          log.address.toLowerCase() === normalizedContract.toLowerCase() &&
          log.topics[0] === transferEventSignature
        );
        
        console.log(`Found ${allUsdcLogs.length} total USDC transfer events:`);
        allUsdcLogs.forEach((log, index) => {
          const logFrom = ethers.getAddress('0x' + log.topics[1].slice(26));
          const logTo = ethers.getAddress('0x' + log.topics[2].slice(26));
          const amount = ethers.formatUnits(log.data, 6);
          console.log(`  ${index + 1}. from=${logFrom}, to=${logTo}, amount=${amount}`);
        });
        
        return { verified: false, error: `No USDC transfer events found from ${normalizedFrom} to ${normalizedTo}` };
      }

      // Decode the transfer amount from the first matching log
      const transferLog = transferLogs[0];
      const actualAmount = ethers.formatUnits(transferLog.data, 6);
      const expectedAmountFormatted = parseFloat(expectedAmount);
      const actualAmountFormatted = parseFloat(actualAmount);
      
      console.log(`Amount verification: expected=${expectedAmountFormatted}, actual=${actualAmountFormatted}`);
      
      // Allow small precision differences due to decimals and rounding
      const ABS_TOLERANCE = 0.01; // 0.01 USDC tolerance (increased for better reliability)
      const verified = Math.abs(expectedAmountFormatted - actualAmountFormatted) <= ABS_TOLERANCE;

      console.log(`Verification result: ${verified ? 'PASSED' : 'FAILED'}`);

      return {
        verified,
        actualAmount,
        error: verified ? undefined : `Amount mismatch: expected ${expectedAmount}, got ${actualAmount}`
      };

    } catch (error) {
      console.error('Error verifying USDC meta transaction:', error);
      return {
        verified: false,
        error: error instanceof Error ? error.message : 'Unknown verification error'
      };
    }
  }

  /**
   * Gets the next available nonce for an address
   */
  public async getNextNonce(address: string): Promise<string> {
    try {
      if (!ethers.isAddress(address)) {
        throw new Error('Invalid address format');
      }

      // Generate a unique nonce based on timestamp and random value
      const nonce = ethers.keccak256(ethers.toUtf8Bytes(`${address}-${Date.now()}-${Math.random()}`));
      
      // Verify it's not already used
      const isUsed = await this.usdcContract.authorizationState(address, nonce);
      if (isUsed) {
        // Recursively try again with a new random value
        return this.getNextNonce(address);
      }

      return nonce;
    } catch (error) {
      console.error('Error getting next nonce:', error);
      throw new Error('Failed to generate nonce');
    }
  }

  /**
   * Gets USDC balance for an address
   */
  public async getBalance(address: string): Promise<string> {
    try {
      if (!ethers.isAddress(address)) {
        throw new Error('Invalid address format');
      }

      const balance = await this.usdcContract.balanceOf(address);
      return ethers.formatUnits(balance, 6);
    } catch (error) {
      console.error('Failed to get USDC balance:', error);
      throw new Error('Failed to retrieve balance');
    }
  }
}
