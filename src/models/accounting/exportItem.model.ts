import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const exportItemSchema = new Schema({
  exportBatchId: { type: Schema.Types.ObjectId, ref: 'ExportBatch', required: true, index: true },
  transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
});

exportItemSchema.index({ transactionId: 1 }, { unique: true });

applyBaseModel(exportItemSchema, mongoose, { softDelete: false, audit: true });

const ExportItem = mongoose.models.ExportItem || mongoose.model('ExportItem', exportItemSchema);

export { exportItemSchema };
export default ExportItem;
