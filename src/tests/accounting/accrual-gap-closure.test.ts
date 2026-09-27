import {
  markBatchFailed,
  touchHeartbeat,
  isAccrualImportSource,
  supersedeFailedBatchHash,
} from '../../services/accounting/accrual/accrualImport.util.js';
import { classifyAmazonOnly } from '../../services/accounting/accrual/accrualReport.service.js';
import { accrualLinesToDatevRows } from '../../helpers/accounting/accrual/accrual-datev-extf.js';

describe('Accrual import recoverability', () => {
  it('markBatchFailed sets failed status and error fields', async () => {
    const updates: any[] = [];
    const repo = {
      update: async (id: string, d: any) => {
        updates.push({ id, ...d });
        return { _id: id, ...d };
      },
    };
    const result = await markBatchFailed(repo, 'batch-1', {
      errorCode: 'TIMEOUT',
      errorMessage: 'hängengeblieben',
    });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.errorMessage).toBe('hängengeblieben');
    expect(result.failedAt).toBeInstanceOf(Date);
    expect(updates).toHaveLength(1);
  });

  it('touchHeartbeat updates lastHeartbeatAt', async () => {
    const repo = {
      update: async (_id: string, d: any) => d,
    };
    const result = await touchHeartbeat(repo, 'b1');
    expect(result.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it('isAccrualImportSource recognizes jtl and marketplace_*', () => {
    expect(isAccrualImportSource('jtl')).toBe(true);
    expect(isAccrualImportSource('marketplace_amazon')).toBe(true);
    expect(isAccrualImportSource('bank')).toBe(false);
    expect(isAccrualImportSource('paypal')).toBe(false);
  });

  it('supersedeFailedBatchHash only for failed accrual batches', async () => {
    const repo = {
      findById: async () => ({
        _id: 'id1',
        source: 'jtl',
        status: 'failed',
        fileHash: 'abc123',
      }),
      update: async (_id: string, d: any) => ({ _id: 'id1', ...d }),
    };
    const result = await supersedeFailedBatchHash(repo, 'id1');
    expect(result.reuploadRequired).toBe(true);
    expect(result.batch.fileHash).toContain(':superseded:id1');
  });
});

describe('Amazon-only classification', () => {
  it('classifies CANCEL / INVOICE_PENDING / UNMATCHED', () => {
    expect(classifyAmazonOnly({ eventType: 'CANCELLATION' })).toBe('CANCEL');
    expect(classifyAmazonOnly({ status: 'invoice_pending' })).toBe('INVOICE_PENDING');
    expect(classifyAmazonOnly({ metadata: { invoicePending: true } })).toBe('INVOICE_PENDING');
    expect(classifyAmazonOnly({ eventType: 'ORDER_CREATED', status: 'pending_match' })).toBe(
      'UNMATCHED',
    );
  });
});

describe('Period coverage gaps (honest empty)', () => {
  it('returns zeros and gaps when from/to missing', async () => {
    const { AccrualReportService } = await import(
      '../../services/accounting/accrual/accrualReport.service.js'
    );
    const svc = new AccrualReportService({
      businessEventRepository: {},
      accountingExceptionRepository: {},
      transactionRepository: {},
      journalEntryRepository: {},
      journalLineRepository: {},
    });
    const result = await svc.periodCoverage(undefined, undefined);
    expect(result.sources.jtl.batches).toBe(0);
    expect(result.sources.amazon.financialBatches).toBe(0);
    expect(result.gaps.length).toBeGreaterThan(0);
  });
});

describe('Accrual DATEV lock isolation', () => {
  it('builds EXTF rows from journal lines without Transaction fields', () => {
    const rows = accrualLinesToDatevRows([
      {
        amountCents: 11900,
        sollHaben: 'S',
        accountNumber: '1400',
        postingDate: new Date('2026-08-01'),
        bookingText: 'Accrual SALE',
      },
      {
        amountCents: 11900,
        sollHaben: 'H',
        accountNumber: '81971',
        postingDate: new Date('2026-08-01'),
        bookingText: 'Accrual SALE',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].konto).toBe('1400');
    expect(rows[0].gegenkonto).toBe('81971');
    expect((rows[0] as any).transactionId).toBeUndefined();
  });
});
