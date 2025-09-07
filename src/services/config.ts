import { BlockchainConfig, UPIConfig } from '../types';

export class ConfigService {
  private static instance: ConfigService;

  // Server Configuration
  public readonly port: number;
  public readonly nodeEnv: string;

  // Security
  public readonly backendPrivateKey: string;
  public readonly treasuryAddress: string;
  public readonly apiKey: string;

  // EIP-7702 Configuration
  public readonly delegationContractAddress: string;

  // UPI Configuration
  public readonly upiConfig: UPIConfig;

  // Blockchain Configurations
  public readonly blockchainConfigs: Record<number, BlockchainConfig>;

  private constructor() {
    // Load environment variables
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.nodeEnv = process.env.NODE_ENV || 'development';

    // Security
    this.backendPrivateKey = this.getRequiredEnv('BACKEND_PRIVATE_KEY');
    this.treasuryAddress = this.getRequiredEnv('TREASURY_ADDRESS');
    this.apiKey = this.getRequiredEnv('API_KEY');

    // EIP-7702
    this.delegationContractAddress = this.getRequiredEnv('DELEGATION_CONTRACT_ADDRESS');

    // UPI Configuration
    this.upiConfig = {
      apiEndpoint: process.env.UPI_API_ENDPOINT || '',
      apiKey: process.env.UPI_API_KEY || '',
      merchantId: process.env.UPI_MERCHANT_ID || '',
    };

    // Get RPC API key (try multiple environment variable names for compatibility)
    const rpcApiKey = process.env.RPC_API_KEY || process.env.ALCHEMY_API_KEY || this.getRequiredEnv('ALCHEMY_API_KEY');

    // Blockchain Configurations
    this.blockchainConfigs = {
      // Ethereum Mainnet
      1: {
        rpcUrl: process.env.ETHEREUM_RPC_URL || `https://eth-mainnet.g.alchemy.com/v2/${rpcApiKey}`,
        chainId: 1,
        usdcContractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      },
      // Arbitrum One
      42161: {
        rpcUrl: process.env.ARBITRUM_RPC_URL || `https://arb-mainnet.g.alchemy.com/v2/${rpcApiKey}`,
        chainId: 42161,
        usdcContractAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      },
      // Sepolia Testnet
      11155111: {
        rpcUrl: process.env.SEPOLIA_RPC_URL || `https://eth-sepolia.g.alchemy.com/v2/${rpcApiKey}`,
        chainId: 11155111,
        usdcContractAddress: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8',
      },
      // Arbitrum Sepolia
      421614: {
        rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || `https://arb-sepolia.g.alchemy.com/v2/${rpcApiKey}`,
        chainId: 421614,
        usdcContractAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      },
    };
  }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  }

  public getBlockchainConfig(chainId: number): BlockchainConfig {
    const config = this.blockchainConfigs[chainId];
    if (!config) {
      throw new Error(`Blockchain configuration not found for chain ID: ${chainId}`);
    }
    return config;
  }

  public isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  public isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}

export const config = ConfigService.getInstance();
