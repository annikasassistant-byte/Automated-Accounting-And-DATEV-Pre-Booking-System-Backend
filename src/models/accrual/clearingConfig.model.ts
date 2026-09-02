import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const marketplaceAccountsSchema = new Schema(
  {
    amazon: {
      clearingAccount: { type: String, default: null, trim: true },
      feeAccount: { type: String, default: null, trim: true },
      refundAccount: { type: String, default: null, trim: true },
      debtorAccount: { type: String, default: null, trim: true },
      fxGainAccount: { type: String, default: null, trim: true },
      fxLossAccount: { type: String, default: null, trim: true },
      adjustmentAccount: { type: String, default: null, trim: true },
    },
    backmarket: {
      clearingAccount: { type: String, default: null, trim: true },
      feeAccount: { type: String, default: null, trim: true },
      refundAccount: { type: String, default: null, trim: true },
      debtorAccount: { type: String, default: null, trim: true },
      fxGainAccount: { type: String, default: null, trim: true },
      fxLossAccount: { type: String, default: null, trim: true },
      adjustmentAccount: { type: String, default: null, trim: true },
    },
    refurbed: {
      clearingAccount: { type: String, default: null, trim: true },
      feeAccount: { type: String, default: null, trim: true },
      refundAccount: { type: String, default: null, trim: true },
      debtorAccount: { type: String, default: null, trim: true },
      fxGainAccount: { type: String, default: null, trim: true },
      fxLossAccount: { type: String, default: null, trim: true },
      adjustmentAccount: { type: String, default: null, trim: true },
    },
  },
  { _id: false },
);

const clearingConfigSchema = new Schema({
  singletonKey: { type: String, default: 'default', unique: true },
  revenueAccountDefault: { type: String, default: null, trim: true },
  marketplaces: { type: marketplaceAccountsSchema, default: () => ({}) },
  fxPolicyNote: { type: String, default: '', trim: true },
});

applyBaseModel(clearingConfigSchema, mongoose, { softDelete: false, audit: true });

const ClearingConfig =
  mongoose.models.ClearingConfig || mongoose.model('ClearingConfig', clearingConfigSchema);

export { clearingConfigSchema };
export default ClearingConfig;
