/**
 * Double-entry sides for one payment (konto + gegenkonto).
 *
 * If booking.sollHaben is S: konto is Soll, gegenkonto is Haben.
 * If H: konto is Haben, gegenkonto is Soll.
 * If missing: outflow (amountCents < 0) → konto Soll / gegenkonto Haben;
 *             inflow → konto Haben / gegenkonto Soll.
 */

export function sidesForPayment(tx) {
  const konto = String(tx?.booking?.konto || '').trim();
  const gegenkonto = String(tx?.booking?.gegenkonto || '').trim();
  if (!konto || !gegenkonto) return null;

  const abs = Math.abs(Number(tx.amountCents) || 0);
  let kontoSide;
  if (tx.booking?.sollHaben === 'S' || tx.booking?.sollHaben === 'H') {
    kontoSide = tx.booking.sollHaben;
  } else {
    kontoSide = tx.amountCents < 0 ? 'S' : 'H';
  }

  return {
    konto,
    gegenkonto,
    kontoSide,
    gegenkontoSide: kontoSide === 'S' ? 'H' : 'S',
    amountCents: abs,
  };
}

export function sideForAccount(sides, accountNumber) {
  if (!sides) return null;
  if (sides.konto === accountNumber) {
    return { side: sides.kontoSide, contraAccount: sides.gegenkonto };
  }
  if (sides.gegenkonto === accountNumber) {
    return { side: sides.gegenkontoSide, contraAccount: sides.konto };
  }
  return null;
}
