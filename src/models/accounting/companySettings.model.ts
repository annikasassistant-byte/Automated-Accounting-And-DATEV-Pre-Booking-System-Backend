import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const companySettingsSchema = new Schema({
  singletonKey: { type: String, default: 'default', unique: true },
  companyName: { type: String, default: 'BuyBack GmbH', trim: true },
  taxId: { type: String, default: '', trim: true },
  street: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  postalCode: { type: String, default: '', trim: true },
  country: { type: String, default: 'DE', trim: true },
  advisorNumber: { type: String, default: '', trim: true },
  clientNumber: { type: String, default: '', trim: true },
  chartOfAccounts: { type: String, default: '03', trim: true },
  currency: { type: String, default: 'EUR', uppercase: true },
  defaultBankAccount: { type: String, default: '1201' },
  defaultPaypalAccount: { type: String, default: '1203' },
  clearingAccount: { type: String, default: '1361' },
  fiscalYearStartMonth: { type: Number, default: 1 },
  blockExportIfOpen: { type: Boolean, default: true },
  blockExportIfUnbalanced: { type: Boolean, default: true },
  allowMatchedWithoutReview: { type: Boolean, default: false },
});

applyBaseModel(companySettingsSchema, mongoose, { softDelete: false, audit: true });

const CompanySettings =
  mongoose.models.CompanySettings || mongoose.model('CompanySettings', companySettingsSchema);

export { companySettingsSchema };
export default CompanySettings;
