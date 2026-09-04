import { ApiError } from '../../../utils/ApiError.js';

export class AccountingMappingService {
  constructor(deps: { taxCodeRepository: any; clearingConfigRepository: any }) {
    this.taxCodes = deps.taxCodeRepository;
    this.clearing = deps.clearingConfigRepository;
  }

  taxCodes;
  clearing;

  async listTaxCodes() {
    const result = await this.taxCodes.findMany({}, { limit: 200, page: 1, sort: 'code' });
    return result.data;
  }

  async upsertTaxCode(body: Record<string, unknown>) {
    if (!body.code) throw ApiError.badRequest('Steuerschlüssel (code) fehlt');
    const existing = await this.taxCodes.findByCode(String(body.code));
    if (existing) {
      return this.taxCodes.update(existing._id, body);
    }
    return this.taxCodes.create(body);
  }

  async resolveAccountsForEvent(event: any) {
    const config = await this.clearing.getOrCreateDefault();
    const marketplace = event.marketplace;
    const mpAccounts = marketplace ? config.marketplaces?.[marketplace] : null;

    let primaryAccount: string | null = config.revenueAccountDefault || null;
    let contraAccount: string | null = mpAccounts?.clearingAccount || null;
    let bookable = true;

    switch (event.eventType) {
      case 'ORDER_CREATED':
      case 'CANCELLATION':
        // Not revenue — no journal until recognized SALE
        bookable = false;
        primaryAccount = null;
        contraAccount = null;
        break;
      case 'SALE':
        // Recognized marketplace sale → per-MP revenue (placeholder) vs clearing/debtor
        primaryAccount =
          mpAccounts?.revenueAccount || config.revenueAccountDefault || mpAccounts?.debtorAccount || null;
        contraAccount = mpAccounts?.clearingAccount || mpAccounts?.debtorAccount || null;
        break;
      case 'SETTLEMENT':
      case 'PAYOUT':
        // Financial sales/revenue + payout = clearing only (never second revenue)
        primaryAccount = mpAccounts?.clearingAccount || null;
        contraAccount = mpAccounts?.debtorAccount || mpAccounts?.clearingAccount || null;
        break;
      case 'FEE':
        primaryAccount = mpAccounts?.feeAccount || primaryAccount;
        contraAccount = mpAccounts?.clearingAccount || contraAccount;
        break;
      case 'REFUND':
        primaryAccount = mpAccounts?.refundAccount || primaryAccount;
        contraAccount = mpAccounts?.clearingAccount || contraAccount;
        break;
      case 'ADJUSTMENT':
        primaryAccount = mpAccounts?.adjustmentAccount || primaryAccount;
        contraAccount = mpAccounts?.clearingAccount || contraAccount;
        break;
      default:
        break;
    }

    return { primaryAccount, contraAccount, config, bookable };
  }
}

export default AccountingMappingService;
