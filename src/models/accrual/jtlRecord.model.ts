import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';
import { JTL_RECORD_TYPES, MARKETPLACES } from '../../enums/accrual.js';

const { Schema } = mongoose;

const jtlRecordSchema = new Schema({
  importBatchId: {
    type: Schema.Types.ObjectId,
    ref: 'ImportBatch',
    required: true,
    index: true,
  },

  recordType: { type: String, enum: JTL_RECORD_TYPES, required: true, index: true },
  sourceRecordId: { type: String, required: true, trim: true },
  sourceIdentityKey: { type: String, required: true, trim: true, index: true },

  jtlOrderId: { type: String, default: null, trim: true, index: true },
  jtlInvoiceNumber: { type: String, default: null, trim: true, index: true },
  marketplaceOrderId: { type: String, default: null, trim: true, index: true },
  marketplace: { type: String, enum: MARKETPLACES, default: null, index: true },
  salesChannel: { type: String, default: null, trim: true, index: true },

  orderDate: { type: Date, default: null },
  invoiceDate: { type: Date, default: null, index: true },
  serviceDate: { type: Date, default: null },

  netAmountCents: { type: Number, default: null },
  vatAmountCents: { type: Number, default: null },
  grossAmountCents: { type: Number, default: null },
  currency: { type: String, default: 'EUR', uppercase: true, trim: true },

  rawRow: { type: Schema.Types.Mixed, default: null },
  businessEventId: {
    type: Schema.Types.ObjectId,
    ref: 'BusinessEvent',
    default: null,
    index: true,
  },
});

jtlRecordSchema.index(
  { sourceIdentityKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } },
);
jtlRecordSchema.index({ marketplaceOrderId: 1, marketplace: 1 });
jtlRecordSchema.index({ jtlInvoiceNumber: 1 });

applyBaseModel(jtlRecordSchema, mongoose, { softDelete: true, audit: true });

const JtlRecord = mongoose.models.JtlRecord || mongoose.model('JtlRecord', jtlRecordSchema);

export { jtlRecordSchema };
export default JtlRecord;
