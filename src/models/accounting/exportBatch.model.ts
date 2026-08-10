import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const exportBatchSchema = new Schema({
  periodType: {
    type: String,
    enum: ['day', 'week', 'month', 'custom'],
    required: true,
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
  transactionIds: [{ type: Schema.Types.ObjectId, ref: 'Transaction' }],
  createdByUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
});

applyBaseModel(exportBatchSchema, mongoose, { softDelete: true, audit: true });

const ExportBatch = mongoose.models.ExportBatch || mongoose.model('ExportBatch', exportBatchSchema);

export { exportBatchSchema };
export default ExportBatch;
