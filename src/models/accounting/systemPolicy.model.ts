import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';
import { DEFAULT_SYSTEM_POLICY } from '../../helpers/accounting/system-policy-defaults.js';

const { Schema } = mongoose;

const enabledSchema = new Schema(
  {
    s1ExcludePaypalTypes: { type: Boolean, default: true },
    s2GuthabenIntegrity: { type: Boolean, default: true },
    s3EurOnly: { type: Boolean, default: true },
    s5BankPaypalClearing: { type: Boolean, default: true },
    s9MarketplacePark: { type: Boolean, default: true },
    s10CommercialVatPark: { type: Boolean, default: true },
    s11OwnerRelatedPark: { type: Boolean, default: true },
    s12ForbiddenCollectives: { type: Boolean, default: true },
    s15Inventory: { type: Boolean, default: true },
  },
  { _id: false },
);

const accountsSchema = new Schema(
  {
    bank: { type: String, default: DEFAULT_SYSTEM_POLICY.accounts.bank, trim: true },
    paypal: { type: String, default: DEFAULT_SYSTEM_POLICY.accounts.paypal, trim: true },
    clearing: { type: String, default: DEFAULT_SYSTEM_POLICY.accounts.clearing, trim: true },
    privateInventory: {
      type: String,
      default: DEFAULT_SYSTEM_POLICY.accounts.privateInventory,
      trim: true,
    },
    forbiddenCollectives: {
      type: [String],
      default: () => [...DEFAULT_SYSTEM_POLICY.accounts.forbiddenCollectives],
    },
  },
  { _id: false },
);

const systemPolicySchema = new Schema({
  singletonKey: { type: String, default: 'default', unique: true },
  accounts: { type: accountsSchema, default: () => ({ ...DEFAULT_SYSTEM_POLICY.accounts }) },
  enabled: { type: enabledSchema, default: () => ({ ...DEFAULT_SYSTEM_POLICY.enabled }) },
  paypalExcludeTypes: {
    type: [String],
    default: () => [...DEFAULT_SYSTEM_POLICY.paypalExcludeTypes],
  },
  marketplacePatterns: {
    type: [String],
    default: () => [...DEFAULT_SYSTEM_POLICY.marketplacePatterns],
  },
  bankPaypalCounterpartyPatterns: {
    type: [String],
    default: () => [...DEFAULT_SYSTEM_POLICY.bankPaypalCounterpartyPatterns],
  },
  bankPaypalPurposePatterns: {
    type: [String],
    default: () => [...DEFAULT_SYSTEM_POLICY.bankPaypalPurposePatterns],
  },
  paypalBankTransferTypePatterns: {
    type: [String],
    default: () => [...DEFAULT_SYSTEM_POLICY.paypalBankTransferTypePatterns],
  },
  ownerRelatedPatterns: {
    type: [String],
    default: () => [...DEFAULT_SYSTEM_POLICY.ownerRelatedPatterns],
  },
  commercialVatHints: {
    type: [String],
    default: () => [...DEFAULT_SYSTEM_POLICY.commercialVatHints],
  },
  inventoryKeywords: {
    type: [String],
    default: () => [...DEFAULT_SYSTEM_POLICY.inventoryKeywords],
  },
  clearingBookingText: {
    type: String,
    default: DEFAULT_SYSTEM_POLICY.clearingBookingText,
    trim: true,
  },
});

applyBaseModel(systemPolicySchema, mongoose, { softDelete: false, audit: true });

const SystemPolicy =
  mongoose.models.SystemPolicy || mongoose.model('SystemPolicy', systemPolicySchema);

export { systemPolicySchema };
export default SystemPolicy;
