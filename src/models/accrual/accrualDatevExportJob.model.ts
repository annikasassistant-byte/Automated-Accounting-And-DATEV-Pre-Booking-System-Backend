import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

/**
 * Accrual DATEV export job — independent of cash ExportBatch / Transaction lock.
 */
const accrualDatevExportJobSchema = new Schema({
  periodType: {
    type: String,
    enum: ['day', 'week', 'month', 'custom'],
    default: 'custom',
  },
  periodStart: { type: Date, required: true, index: true },
  periodEnd: { type: Date, required: true, index: true },
  fileName: { type: String, required: true },
  fileHash: { type: String, default: null },
  fileContent: { type: String, default: null },
  encoding: { type: String, default: 'cp1252' },
  rowCount: { type: Number, default: 0 },
  checksum: { type: String, default: null },
  totalsByAccount: { type: Schema.Types.Mixed, default: {} },
  validationResults: {
    errors: [{ type: String }],
    warnings: [{ type: String }],
    passed: { type: Boolean, default: false },
  },
  journalEntryIds: [{ type: Schema.Types.ObjectId, ref: 'JournalEntry' }],
  journalLineIds: [{ type: Schema.Types.ObjectId, ref: 'JournalLine' }],
  createdByUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['created', 'downloaded', 'void'],
    default: 'created',
    index: true,
  },
});

applyBaseModel(accrualDatevExportJobSchema, mongoose, { softDelete: true, audit: true });

const AccrualDatevExportJob =
  mongoose.models.AccrualDatevExportJob ||
  mongoose.model('AccrualDatevExportJob', accrualDatevExportJobSchema);

export { accrualDatevExportJobSchema };
export default AccrualDatevExportJob;
