import { applyHumanRules } from '../helpers/accounting/rule-engine.js';

const rules2 = [
  {
    _id: 'a',
    enabled: true,
    conditions: [{ field: 'purpose', operator: 'contains', value: 'E2ECONFLICT' }],
    actions: { konto: '4910', gegenkonto: '1201' },
  },
  {
    _id: 'b',
    enabled: true,
    conditions: [{ field: 'purpose', operator: 'contains', value: 'E2ECONFLICT' }],
    actions: { konto: '4970', gegenkonto: '1201' },
  },
];

const zero = applyHumanRules(
  { source: 'bank', amountCents: -100, purpose: 'NONE', counterpartyName: 'X', rawDescription: 'noop' },
  rules2,
);
const one = applyHumanRules(
  { source: 'bank', amountCents: -100, purpose: 'E2ECONFLICT', counterpartyName: 'X', rawDescription: 'E2ECONFLICT' },
  [rules2[0]],
);
const two = applyHumanRules(
  { source: 'bank', amountCents: -100, purpose: 'E2ECONFLICT', counterpartyName: 'X', rawDescription: 'E2ECONFLICT' },
  rules2,
);

console.log(JSON.stringify({ zero: zero.status, one: one.status, two: two.status, twoIds: two.matchedRuleIds }));
if (zero.status !== 'open' || one.status !== 'matched' || two.status !== 'conflict') {
  process.exit(1);
}
console.log('RULE_MATCH_MATRIX_OK');
