import axios, { AxiosInstance, AxiosResponse } from 'axios';
import https from 'https';
import { ethers } from 'ethers';
import { config } from './config';
import { 
  ChainalysisSanctionsResponse, 
  ChainalysisSanctionsIdentification, 
  SanctionsScreeningResult 
} from '../types';

export class ChainalysisService {
  private static instance: ChainalysisService;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly client: AxiosInstance;

  private constructor() {
    this.apiKey = config.chainalysisApiKey;
    this.baseUrl = config.chainalysisApiUrl;

    // Create axios instance with keep-alive and diagnostics (10s timeout as requested)
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'X-API-KEY': this.apiKey,
        'Accept': 'application/json',
        'User-Agent': 'StableUPI-Backend/1.0 (+sanctions-check)'
      },
      httpsAgent: new https.Agent({ keepAlive: true })
    });

    // Basic latency logging
    this.client.interceptors.request.use((config) => {
      (config as any).metadata = { start: Date.now() };
      return config;
    });
    this.client.interceptors.response.use((response) => {
      const meta = (response.config as any).metadata;
      const ms = meta && meta.start ? Date.now() - meta.start : undefined;
      if (ms !== undefined) {
        console.log(`Chainalysis API ${response.config.method?.toUpperCase()} ${response.config.url} -> ${response.status} in ${ms}ms`);
      }
      return response;
    }, (error) => {
      const config: any = error.config || {};
      const ms = config.metadata && config.metadata.start ? Date.now() - config.metadata.start : undefined;
      const code = error.code || error.response?.status;
      console.warn(`Chainalysis API error for ${config.method?.toUpperCase()} ${config.url} after ${ms ?? 'N/A'}ms: ${code} ${error.message}`);
      return Promise.reject(error);
    });
  }

  public static getInstance(): ChainalysisService {
    if (!ChainalysisService.instance) {
      ChainalysisService.instance = new ChainalysisService();
    }
    return ChainalysisService.instance;
  }

  /**
   * Check if a wallet address is sanctioned
   * @param address - The wallet address to check
   * @returns Promise<SanctionsScreeningResult>
   */
  public async checkSanctions(address: string): Promise<SanctionsScreeningResult> {
    try {
      if (!this.apiKey) {
        console.warn('Chainalysis API key not configured, skipping sanctions check');
        return {
          isSanctioned: false,
          identifications: [],
          screenedAt: new Date()
        };
      }

      // Validate address format
      if (!this.isValidAddress(address)) {
        throw new Error('Invalid wallet address format');
      }

      // Normalize to checksum casing as the API is case-sensitive
      let checksumAddress = address;
      try {
        checksumAddress = ethers.getAddress(address);
      } catch {}

      const response: AxiosResponse<ChainalysisSanctionsResponse> = await this.client.get(`/address/${checksumAddress}`);

      const identifications = response.data.identifications || [];
      const isSanctioned = identifications.length > 0;

      console.log(`Sanctions check for address ${address}: ${isSanctioned ? 'SANCTIONED' : 'CLEAN'}`);

      return {
        isSanctioned,
        identifications,
        screenedAt: new Date()
      };

    } catch (error: any) {
      console.error('Chainalysis sanctions check failed:', error.message);
      
      // If it's a rate limit error, we should still allow the transaction
      // but log it for monitoring
      if (error.response?.status === 403) {
        console.warn('Chainalysis API rate limited, allowing transaction to proceed');
        return {
          isSanctioned: false,
          identifications: [],
          screenedAt: new Date()
        };
      }

      // For other errors, we should be more cautious
      // In production, you might want to implement a fallback strategy
      throw new Error(`Sanctions screening failed: ${error.message}`);
    }
  }

  /**
   * Check if multiple addresses are sanctioned
   * @param addresses - Array of wallet addresses to check
   * @returns Promise<Map<string, SanctionsScreeningResult>>
   */
  public async checkMultipleSanctions(addresses: string[]): Promise<Map<string, SanctionsScreeningResult>> {
    const results = new Map<string, SanctionsScreeningResult>();
    
    // Process addresses in batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (address) => {
        try {
          const result = await this.checkSanctions(address);
          results.set(address, result);
        } catch (error) {
          console.error(`Failed to check sanctions for address ${address}:`, error);
          // Set a default result for failed checks
          results.set(address, {
            isSanctioned: false,
            identifications: [],
            screenedAt: new Date()
          });
        }
      });

      await Promise.all(batchPromises);
      
      // Add a small delay between batches to respect rate limits
      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Validate wallet address format
   * @param address - The address to validate
   * @returns boolean
   */
  private isValidAddress(address: string): boolean {
    // Basic Ethereum address validation (42 characters, starts with 0x)
    const ethereumAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethereumAddressRegex.test(address);
  }

  /**
   * Get API status and rate limit information
   * @returns Promise<{isConfigured: boolean, rateLimitRemaining?: number}>
   */
  public async getApiStatus(): Promise<{isConfigured: boolean, rateLimitRemaining?: number}> {
    if (!this.apiKey) {
      return { isConfigured: false };
    }

    try {
      // Make a test request to check API status
      const response = await axios.get(
        `${this.baseUrl}/address/0x0000000000000000000000000000000000000000`,
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      const rateLimitRemaining = response.headers['x-ratelimit-remaining'];
      
      return {
        isConfigured: true,
        rateLimitRemaining: rateLimitRemaining ? parseInt(rateLimitRemaining) : undefined
      };
    } catch (error: any) {
      console.error('Failed to check Chainalysis API status:', error.message);
      return { isConfigured: false };
    }
  }
}

export const chainalysisService = ChainalysisService.getInstance();
