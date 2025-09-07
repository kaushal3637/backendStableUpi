import { ethers } from 'ethers';
import { EIP7702SponsoredRequest, EIP7702Authorization, EIP7702Call, ERC7702Response } from '../types';
import { config } from './config';

export class EIP7702Service {
  private provider: ethers.JsonRpcProvider;
  private sponsorSigner: ethers.Wallet; // Backend wallet that pays for gas
  private chainId: number;

  // Delegation contract ABI based on QuickNode guide
  private delegationContractAbi = [
    "function execute((address,uint256,bytes)[] calls) external",
    "function execute((address,uint256,bytes)[] calls, bytes signature) external",
    "function nonce() external view returns (uint256)"
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
      console.log('Processing sponsored EIP-7702 transaction...');

      // Validate authorization
      const isValidAuth = await this.validateAuthorization(request.authorization, request.userAddress);
      if (!isValidAuth) {
        return {
          success: false,
          status: 'failed',
          error: 'Invalid authorization signature'
        };
      }

      // Check if EOA is already delegated
      const delegationStatus = await this.checkDelegationStatus(request.userAddress);
      console.log('Delegation status:', delegationStatus);

      // Create transaction based on whether delegation exists
      let txReceipt;
      if (delegationStatus.isDelegated) {
        // EOA is already delegated - send sponsored transaction
        txReceipt = await this.sendSponsoredDelegatedTransaction(request);
      } else {
        // First time delegation - send EIP-7702 transaction with authorization
        txReceipt = await this.sendInitialDelegationTransaction(request);
      }

      return {
        success: true,
        transactionHash: txReceipt.hash,
        status: 'completed'
      };

    } catch (error) {
      console.error('Error processing sponsored EIP-7702 transaction:', error);
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Sends initial EIP-7702 transaction with authorization (first delegation)
   */
  private async sendInitialDelegationTransaction(request: EIP7702SponsoredRequest) {
    console.log('Sending initial EIP-7702 transaction with delegation...');

    // Prepare calls in the format expected by delegation contract
    const formattedCalls = request.calls.map(call => [
      call.to,
      ethers.parseEther(call.value || "0"),
      call.data || "0x"
    ]);

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

    console.log('Sending EIP-7702 transaction:', eip7702Tx);

    // Send transaction from sponsor
    const tx = await this.sponsorSigner.sendTransaction(eip7702Tx);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('EIP-7702 transaction failed');
    }

    console.log('EIP-7702 transaction successful:', receipt.hash);
    return receipt;
  }

  /**
   * Sends sponsored transaction to already delegated EOA
   */
  private async sendSponsoredDelegatedTransaction(request: EIP7702SponsoredRequest) {
    console.log('Sending sponsored transaction to delegated EOA...');

    // Get delegation contract instance
    const delegationContract = new ethers.Contract(
      config.delegationContractAddress,
      this.delegationContractAbi,
      this.sponsorSigner
    );

    // Prepare calls
    const formattedCalls = request.calls.map(call => [
      call.to,
      ethers.parseEther(call.value || "0"),
      call.data || "0x"
    ]);

    // Get contract nonce for signature verification
    const contractNonce = await delegationContract.nonce();

    // Create signature for the sponsored transaction
    // Note: This would typically be signed by the user's EOA
    const digest = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "bytes"],
        [contractNonce, ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address,uint256,bytes)[]"], [formattedCalls])]
      )
    );

    // For sponsored transactions, we need a signature from the EOA owner
    // This signature should be provided by the frontend
    const mockSignature = "0x" + "00".repeat(65); // Placeholder - should come from frontend

    // Send transaction to delegated EOA
    const tx = await delegationContract["execute((address,uint256,bytes)[],bytes)"](
      formattedCalls,
      mockSignature
    );

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
      
      if (code === '0x') {
        return { isDelegated: false };
      }

      // Check for EIP-7702 delegation designator (0xef0100 + address)
      if (code.startsWith('0xef0100') && code.length === 46) {
        const delegatedAddress = '0x' + code.slice(6);
        return {
          isDelegated: true,
          delegatedTo: delegatedAddress
        };
      }

      return { isDelegated: false };
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
