import { ApiError } from '../../../utils/ApiError.js';
import {
  DEFAULT_FEE_VAT,
  DEFAULT_TAX_CODES,
  buildFeeVatExtraLines,
  vatCentsFromNet,
} from '../../../helpers/accounting/accrual/fee-vat.util.js';

export class FeeVatService {
  constructor(deps: {
    businessEventRepository: any;
    taxCodeRepository: any;
    clearingConfigRepository: any;
  }) {
    this.events = deps.businessEventRepository;
    this.taxCodes = deps.taxCodeRepository;
    this.clearing = deps.clearingConfigRepository;
  }

  events;
  taxCodes;
  clearing;

  async seedTaxCodes() {
    let created = 0;
    for (const row of DEFAULT_TAX_CODES) {
      const existing = await this.taxCodes.findByCode(row.code);
      if (!existing) {
        await this.taxCodes.create(row);
        created++;
      }
    }
    return { created, total: DEFAULT_TAX_CODES.length };
  }

  async previewMonth(from?: string, to?: string) {
    await this.seedTaxCodes();
    const config = await this.clearing.getOrCreateDefault();
    const filter: Record<string, unknown> = { eventType: 'FEE' };
    if (from || to) {
      filter.eventDate = {};
      if (from) (filter.eventDate as any).$gte = new Date(from);
      if (to) (filter.eventDate as any).$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.000Z`);
    }
    const result = await this.events.findMany(filter, { limit: 5000, page: 1, sort: 'eventDate' });
    const items = result.data || [];

    const byMarketplace: Record<
      string,
      {
        marketplace: string;
        treatment: string;
        feeNetCents: number;
        vatCents: number;
        eventCount: number;
        inputVatAccount: string | null;
        outputVatAccount: string | null;
      }
    > = {};

    const eventRows = [];
    for (const ev of items) {
      const mp = ev.marketplace || 'unknown';
      const netCents = Math.abs(ev.fx?.eurAmountCents ?? ev.fx?.originalAmountCents ?? 0);
      const extra = buildFeeVatExtraLines({
        netCents,
        marketplace: ev.marketplace,
        override: ev.feeVatTreatment,
        feeVatConfig: config.feeVat,
        clearingAccount: config.marketplaces?.[mp]?.clearingAccount,
      });
      if (!byMarketplace[mp]) {
        const def = DEFAULT_FEE_VAT[mp] || DEFAULT_FEE_VAT.kaufland;
        byMarketplace[mp] = {
          marketplace: mp,
          treatment: extra.treatment,
          feeNetCents: 0,
          vatCents: 0,
          eventCount: 0,
          inputVatAccount: def.inputVatAccount,
          outputVatAccount: def.outputVatAccount,
        };
      }
      byMarketplace[mp].feeNetCents += netCents;
      byMarketplace[mp].vatCents += extra.vatCents;
      byMarketplace[mp].eventCount += 1;
      eventRows.push({
        eventId: ev._id,
        marketplace: mp,
        treatment: extra.treatment,
        override: ev.feeVatTreatment || 'auto',
        feeNetCents: netCents,
        vatCents: extra.vatCents,
        lines: extra.lines,
      });
    }

    const summaries = Object.values(byMarketplace);
    const rc = summaries.filter((s) => s.treatment === 'reverse_charge_13b');
    const example = {
      note: 'If reverse-charge fees total €10,000 at 19%, the system books €1,900 debit input VAT §13b and €1,900 credit output VAT §13b. Both enter the monthly VAT view even when they net to zero.',
      sampleFeeNetCents: 1_000_000,
      sampleVatCents: vatCentsFromNet(1_000_000, 19),
      reverseChargeFeeNetCents: rc.reduce((a, s) => a + s.feeNetCents, 0),
      reverseChargeVatCents: rc.reduce((a, s) => a + s.vatCents, 0),
    };

    return {
      period: { from: from || null, to: to || null },
      summaries,
      example,
      events: eventRows.slice(0, 200),
      eventCount: items.length,
    };
  }
}

export default FeeVatService;
