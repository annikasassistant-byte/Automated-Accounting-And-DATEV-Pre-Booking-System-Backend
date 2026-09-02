import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const taxCodeSchema = new Schema({
  code: { type: String, required: true, trim: true, unique: true },
  label: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  buKey: { type: String, default: null, trim: true },
  vatRatePercent: { type: Number, default: null },
  classification: { type: String, default: null, trim: true },
  enabled: { type: Boolean, default: true, index: true },
});

applyBaseModel(taxCodeSchema, mongoose, { softDelete: true, audit: true });

const TaxCode = mongoose.models.TaxCode || mongoose.model('TaxCode', taxCodeSchema);

export { taxCodeSchema };
export default TaxCode;
