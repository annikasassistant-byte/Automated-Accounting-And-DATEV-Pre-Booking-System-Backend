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

    let primaryAccount = config.revenueAccountDefault;
    let contraAccount = mpAccounts?.clearingAccount || null;

    switch (event.eventType) {
      case 'FEE':
        primaryAccount = mpAccounts?.feeAccount || primaryAccount;
        break;
      case 'REFUND':
        primaryAccount = mpAccounts?.refundAccount || primaryAccount;
        break;
      case 'ADJUSTMENT':
        primaryAccount = mpAccounts?.adjustmentAccount || primaryAccount;
        break;
      case 'SALE':
      case 'ORDER_CREATED':
        primaryAccount = mpAccounts?.debtorAccount || primaryAccount;
        break;
      default:
        break;
    }

    return { primaryAccount, contraAccount, config };
  }
}

export default AccountingMappingService;
