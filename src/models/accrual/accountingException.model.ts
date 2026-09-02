import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';
import { ACCOUNTING_EXCEPTION_TYPES, EXCEPTION_STATUSES } from '../../enums/accrual.js';

const { Schema } = mongoose;

const accountingExceptionSchema = new Schema({
  exceptionType: {
    type: String,
    enum: ACCOUNTING_EXCEPTION_TYPES,
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: EXCEPTION_STATUSES,
    default: 'open',
    index: true,
  },

  businessEventId: {
    type: Schema.Types.ObjectId,
    ref: 'BusinessEvent',
    default: null,
    index: true,
  },
  importBatchId: {
    type: Schema.Types.ObjectId,
    ref: 'ImportBatch',
    default: null,
    index: true,
  },

  marketplace: { type: String, default: null, trim: true, index: true },
  marketplaceOrderId: { type: String, default: null, trim: true },
  sourceRecordId: { type: String, default: null, trim: true },

  title: { type: String, required: true, trim: true },
  detail: { type: String, default: '', trim: true },
  metadata: { type: Schema.Types.Mixed, default: null },

  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolutionNote: { type: String, default: null, trim: true },
});

accountingExceptionSchema.index({ status: 1, exceptionType: 1, createdAt: -1 });

applyBaseModel(accountingExceptionSchema, mongoose, { softDelete: true, audit: true });

const AccountingException =
  mongoose.models.AccountingException ||
  mongoose.model('AccountingException', accountingExceptionSchema);

export { accountingExceptionSchema };
export default AccountingException;
