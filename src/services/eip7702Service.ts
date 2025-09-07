import { ethers } from 'ethers';
import { EIP7702SponsoredRequest, EIP7702Authorization, EIP7702Call, ERC7702Response } from '../types';
import { config } from './config';

export class EIP7702Service {
  private provider: ethers.JsonRpcProvider;
  private sponsorSigner: ethers.Wallet; // Backend wallet that pays for gas
  private chainId: number;

  // Delegation contract ABI based on the actual contract
  private delegationContractAbi = [
    "function execute((address,uint256,bytes)[] calls) external",
    "function isDelegationActive() external view returns (bool)",
    "function getBalance() external view returns (uint256)"
  ];

  constructor(chainId: number) {
    this.chainId = chainId;
    const blockchainConfig = config.getBlockchainConfig(chainId);
    this.provider = new ethers.JsonRpcProvider(blockchainConfig.rpcUrl);
    this.sponsorSigner = new ethers.Wallet(config.backendPrivateKey, this.provider);
  }

  /**
   * Validates EIP-7702 authorization signature
   */
  public async validateAuthorization(auth: EIP7702Authorization, userAddress: string): Promise<boolean> {
    try {
      // Verify chain ID matches
      if (auth.chainId !== this.chainId) {
        console.error('Chain ID mismatch in authorization');
        return false;
      }

      // Verify the authorization signature format
      if (!auth.address || !auth.r || !auth.s || auth.yParity === undefined) {
        console.error('Invalid authorization signature format');
        return false;
      }

      // Verify authorization points to our delegation contract
      if (auth.address.toLowerCase() !== config.delegationContractAddress.toLowerCase()) {
        console.error('Authorization must point to configured delegation contract:', config.delegationContractAddress);
        return false;
      }

      // Additional validation: check if delegation contract exists
      const code = await this.provider.getCode(auth.address);
      if (code === '0x') {
        console.error('Delegation contract not found at address:', auth.address);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Authorization validation failed:', error);
      return false;
    }
  }

  /**
   * Sends a sponsored EIP-7702 transaction
   */
  public async sendSponsoredTransaction(request: EIP7702SponsoredRequest): Promise<ERC7702Response> {
    try {
      console.log('=== Processing Sponsored EIP-7702 Transaction ===');
      console.log('User Address:', request.userAddress);
      console.log('Chain ID:', request.chainId);
      console.log('Calls Count:', request.calls.length);
      
      // Log call details
      request.calls.forEach((call, i) => {
        console.log(`Call ${i}:`);
        console.log(`  To: ${call.to}`);
        console.log(`  Value: ${call.value}`);
        console.log(`  Data: ${call.data.slice(0, 100)}...`);
      });

      // Validate authorization
      console.log('Validating authorization...');
      const isValidAuth = await this.validateAuthorization(request.authorization, request.userAddress);
      if (!isValidAuth) {
        console.error('❌ Authorization validation failed');
        return {
          success: false,
          status: 'failed',
          error: 'Invalid authorization signature'
        };
      }
      console.log('✅ Authorization valid');

      // Check if EOA is already delegated
      console.log('Checking delegation status...');
      const delegationStatus = await this.checkDelegationStatus(request.userAddress);
      console.log('Delegation status:', delegationStatus);

      // Check sponsor wallet balance
      const sponsorBalance = await this.provider.getBalance(this.sponsorSigner.address);
      console.log(`Sponsor wallet balance: ${ethers.formatEther(sponsorBalance)} ETH`);

      // Create transaction based on whether delegation exists
      let txReceipt;
      if (delegationStatus.isDelegated) {
        console.log('📤 Sending sponsored transaction to already-delegated EOA...');
        txReceipt = await this.sendSponsoredDelegatedTransaction(request);
      } else {
        console.log('🔧 Sending delegation-only EIP-7702 transaction...');
        const delegationReceipt = await this.sendDelegationOnlyTransaction(request);
        if (!delegationReceipt) {
          throw new Error('Delegation transaction returned no receipt');
        }
        console.log('Delegation tx mined:', delegationReceipt.hash);
        console.log('⏳ Waiting for delegation to become active...');
        const activated = await this.waitForDelegationActive(request.userAddress, 20, 1500);
        if (!activated) {
          throw new Error('Delegation did not become active in time');
        }
        console.log('✅ Delegation active. Proceeding to execute calls...');
        txReceipt = await this.sendSponsoredDelegatedTransaction(request);
      }

      console.log('✅ Transaction successful:', txReceipt.hash);
      console.log('Gas used:', txReceipt.gasUsed?.toString());
      console.log('Block number:', txReceipt.blockNumber);
      
      // Log events
      if (txReceipt.logs && txReceipt.logs.length > 0) {
        console.log('Events emitted:');
        txReceipt.logs.forEach((log, i) => {
          console.log(`  Event ${i}:`, log.address, log.topics[0]);
        });
      }

      return {
        success: true,
        transactionHash: txReceipt.hash,
        status: 'completed'
      };

    } catch (error) {
      console.error('❌ Error processing sponsored EIP-7702 transaction:', error);
      
      // Enhanced error logging
      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        if ('code' in error) console.error('Error code:', (error as any).code);
        if ('data' in error) console.error('Error data:', (error as any).data);
      }
      
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Sends a pure EIP-7702 delegation transaction (no calls executed in the same tx)
   */
  private async sendDelegationOnlyTransaction(request: EIP7702SponsoredRequest) {
    // Create EIP-7702 transaction with only authorization list to establish delegation
    const eip7702Tx = {
      type: 0x04 as const,
      to: request.userAddress,
      value: 0,
      data: "0x",
      gasLimit: 150000,
      maxFeePerGas: ethers.parseUnits('20', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
      chainId: this.chainId,
      authorizationList: [
        {
          chainId: request.authorization.chainId,
          address: request.authorization.address,
          nonce: request.authorization.nonce,
          signature: {
            yParity: request.authorization.yParity as 0 | 1,
            r: request.authorization.r,
            s: request.authorization.s
          }
        }
      ]
    };

    console.log('Sending delegation-only EIP-7702 tx to:', eip7702Tx.to);
    const tx = await this.sponsorSigner.sendTransaction(eip7702Tx);
    return await tx.wait();
  }

  /**
   * Waits until the EOA shows delegated code (per EIP-7702) or timeout
   */
  private async waitForDelegationActive(address: string, maxRetries = 20, delayMs = 1500): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const status = await this.checkDelegationStatus(address);
        if (status.isDelegated) return true;
      } catch (err) {
        // ignore and retry
      }
      await new Promise(res => setTimeout(res, delayMs));
    }
    return false;
  }

  /**
   * Sends initial EIP-7702 transaction with authorization (first delegation)
   */
  private async sendInitialDelegationTransaction(request: EIP7702SponsoredRequest) {
    console.log('=== Sending Initial EIP-7702 Delegation Transaction ===');

    // Prepare calls in the format expected by delegation contract
    const formattedCalls = request.calls.map(call => [
      call.to,
      call.value === "0" ? 0 : ethers.parseEther(call.value), // Handle USDC (value=0) vs ETH transfers
      call.data || "0x"
    ]);

    console.log('Formatted calls for delegation contract:');
    formattedCalls.forEach((call, i) => {
      const data = typeof call[2] === 'string' ? call[2] : String(call[2]);
      console.log(`  Call ${i}: [${call[0]}, ${call[1].toString()}, ${data.slice(0, 50)}...]`);
    });

    // Create delegation contract interface
    const delegationContract = new ethers.Contract(
      config.delegationContractAddress,
      this.delegationContractAbi,
      this.sponsorSigner
    );

    // Encode function call for the delegation contract
    const callData = delegationContract.interface.encodeFunctionData(
      "execute((address,uint256,bytes)[])",
      [formattedCalls]
    );

    console.log('Encoded call data:', callData);
    console.log('Delegation contract address:', config.delegationContractAddress);

    // Create EIP-7702 transaction
    const eip7702Tx = {
      type: 0x04, // EIP-7702 transaction type
      to: request.userAddress, // Send to EOA address
      value: 0,
      data: callData,
      gasLimit: 500000,
      maxFeePerGas: ethers.parseUnits('20', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
      chainId: this.chainId,
      authorizationList: [
        {
          chainId: request.authorization.chainId,
          address: request.authorization.address,
          nonce: request.authorization.nonce,
          signature: {
            yParity: request.authorization.yParity as 0 | 1,
            r: request.authorization.r,
            s: request.authorization.s
          }
        }
      ]
    };

    console.log('EIP-7702 transaction details:');
    console.log('  Type:', eip7702Tx.type);
    console.log('  To (EOA):', eip7702Tx.to);
    console.log('  Value:', eip7702Tx.value);
    console.log('  Gas Limit:', eip7702Tx.gasLimit);
    console.log('  Max Fee:', ethers.formatUnits(eip7702Tx.maxFeePerGas, 'gwei'), 'gwei');
    console.log('  Authorization:');
    console.log('    Chain ID:', eip7702Tx.authorizationList[0].chainId);
    console.log('    Delegate To:', eip7702Tx.authorizationList[0].address);
    console.log('    Nonce:', eip7702Tx.authorizationList[0].nonce);
    console.log('    yParity:', eip7702Tx.authorizationList[0].signature.yParity);

    // Send transaction from sponsor
    console.log('Sending transaction from sponsor:', this.sponsorSigner.address);
    const tx = await this.sponsorSigner.sendTransaction(eip7702Tx);
    console.log('Transaction sent, hash:', tx.hash);
    console.log('Waiting for confirmation...');

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      console.error('❌ EIP-7702 transaction failed');
      console.error('Receipt status:', receipt?.status);
      throw new Error('EIP-7702 transaction failed');
    }

    console.log('✅ EIP-7702 transaction successful!');
    console.log('  Hash:', receipt.hash);
    console.log('  Block:', receipt.blockNumber);
    console.log('  Gas used:', receipt.gasUsed?.toString());
    console.log('  Events:', receipt.logs?.length || 0);

    // Verify delegation was successful
    setTimeout(async () => {
      const newStatus = await this.checkDelegationStatus(request.userAddress);
      console.log('Post-transaction delegation status:', newStatus);
    }, 1000);

    return receipt;
  }

  /**
   * Sends sponsored transaction to already delegated EOA
   */
  private async sendSponsoredDelegatedTransaction(request: EIP7702SponsoredRequest) {
    console.log('Sending sponsored transaction to delegated EOA...');

    // Create delegation contract interface for encoding
    const delegationContract = new ethers.Contract(
      config.delegationContractAddress,
      this.delegationContractAbi,
      this.provider
    );

    // Prepare calls in the format expected by delegation contract
    const formattedCalls = request.calls.map(call => [
      call.to,
      ethers.parseEther(call.value || "0"),
      call.data || "0x"
    ]);

    // Encode the execute function call
    const callData = delegationContract.interface.encodeFunctionData(
      "execute((address,uint256,bytes)[])",
      [formattedCalls]
    );

    // Send a regular transaction to the delegated EOA address
    // The EOA will execute this via its delegated contract code
    const tx = await this.sponsorSigner.sendTransaction({
      to: request.userAddress, // Send to the EOA address directly
      value: 0,
      data: callData,
      gasLimit: 500000,
      maxFeePerGas: ethers.parseUnits('20', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei')
    });

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Sponsored transaction failed');
    }

    console.log('Sponsored transaction successful:', receipt.hash);
    return receipt;
  }

  /**
   * Checks delegation status of an EOA
   */
  public async checkDelegationStatus(address: string): Promise<{
    isDelegated: boolean;
    delegatedTo?: string;
  }> {
    try {
      const code = await this.provider.getCode(address);

      // EOAs without delegation have no code
      if (code === '0x') {
        return { isDelegated: false };
      }

      // EIP-7702: code should be 0xef0100 + 20-byte address → 23 bytes total
      // Hex string length including 0x should be 2 + 23*2 = 48
      if (code.startsWith('0xef0100')) {
        // Extract the last 20 bytes as address regardless of minor length variations
        const last40 = code.slice(-40);
        const delegatedAddress = /^0x[a-fA-F0-9]{40}$/.test('0x' + last40) ? ('0x' + last40) : undefined;
        return {
          isDelegated: true,
          delegatedTo: delegatedAddress
        };
      }

      // Some clients might return non-empty code differently; treat as delegated
      return { isDelegated: true };
    } catch (error) {
      console.error('Error checking delegation status:', error);
      return { isDelegated: false };
    }
  }

  /**
   * Revokes delegation for an EOA
   */
  public async revokeDelegation(userAddress: string): Promise<ERC7702Response> {
    try {
      // Create revocation authorization (empty address revokes delegation)
      const revocationAuth = {
        chainId: this.chainId,
        address: '0x0000000000000000000000000000000000000000',
        nonce: "0x0",
        yParity: 0,
        r: "0x" + "00".repeat(32),
        s: "0x" + "00".repeat(32)
      };

      const eip7702Tx = {
        type: 0x04,
        to: userAddress,
        value: 0,
        data: "0x",
        gasLimit: 100000,
        maxFeePerGas: ethers.parseUnits('20', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
        chainId: this.chainId,
        authorizationList: [
          {
            chainId: revocationAuth.chainId,
            address: revocationAuth.address,
            nonce: revocationAuth.nonce,
            signature: {
              yParity: revocationAuth.yParity as 0 | 1,
              r: revocationAuth.r,
              s: revocationAuth.s
            }
          }
        ]
      };

      const tx = await this.sponsorSigner.sendTransaction(eip7702Tx);
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('Delegation revocation failed');
      }

      return {
        success: true,
        transactionHash: receipt.hash,
        status: 'completed'
      };

    } catch (error) {
      console.error('Error revoking delegation:', error);
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}
