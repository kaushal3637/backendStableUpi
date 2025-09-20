import AllowlistedWallet, { IAllowlistedWallet } from '../models/AllowlistedWallet';

export class AllowlistService {
  /**
   * Lookup by lowercase wallet address
   */
  public async getByWalletAddressLower(addressLower: string): Promise<IAllowlistedWallet | null> {
    return AllowlistedWallet.findOne({ walletAddressLower: addressLower });
  }

  /**
   * Upsert from sanctions result
   */
  public async upsertFromSanctionsResult(params: {
    walletAddressLower: string;
    checksumAddress: string;
    isSanctioned: boolean;
    identifications: any[];
  }): Promise<IAllowlistedWallet> {
    const now = new Date();

    const existing = await AllowlistedWallet.findOne({ walletAddressLower: params.walletAddressLower });

    if (existing) {
      existing.checksumAddress = params.checksumAddress;
      existing.isSanctioned = params.isSanctioned;
      existing.identifications = params.identifications;
      existing.screenedAt = now;
      if (!params.isSanctioned && !existing.addedToAllowlistAt) {
        existing.addedToAllowlistAt = now;
      }
      await existing.save();
      return existing;
    }

    const created = new AllowlistedWallet({
      walletAddressLower: params.walletAddressLower,
      checksumAddress: params.checksumAddress,
      isSanctioned: params.isSanctioned,
      identifications: params.identifications,
      screenedAt: now,
      addedToAllowlistAt: params.isSanctioned ? undefined : now
    });

    return created.save();
  }
}

export const allowlistService = new AllowlistService();
