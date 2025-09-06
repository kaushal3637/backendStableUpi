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

  // ERC-7702 Configuration
  public readonly entryPointAddress: string;
  public readonly accountFactoryAddress: string;

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

    // ERC-7702
    this.entryPointAddress = process.env.ENTRYPOINT_ADDRESS || '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
    this.accountFactoryAddress = process.env.ACCOUNT_FACTORY_ADDRESS || '';

    // UPI Configuration
    this.upiConfig = {
      apiEndpoint: process.env.UPI_API_ENDPOINT || '',
      apiKey: process.env.UPI_API_KEY || '',
      merchantId: process.env.UPI_MERCHANT_ID || '',
    };

    // Blockchain Configurations
    this.blockchainConfigs = {
      // Ethereum Mainnet
      1: {
        rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://1rpc.io/eth',
        chainId: 1,
        usdcContractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        entryPointAddress: this.entryPointAddress,
      },
      // Arbitrum One
      42161: {
        rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://1rpc.io/arb',
        chainId: 42161,
        usdcContractAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        entryPointAddress: this.entryPointAddress,
      },
      // Sepolia Testnet
      11155111: {
        rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://1rpc.io/sepolia',
        chainId: 11155111,
        usdcContractAddress: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8',
        entryPointAddress: this.entryPointAddress,
      },
      // Arbitrum Sepolia
      421614: {
        rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
        chainId: 421614,
        usdcContractAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        entryPointAddress: this.entryPointAddress,
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
