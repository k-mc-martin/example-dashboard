// The same invariant checks the healthy ledger and the deliberately faulty receipt fixture.
export function compareReceipts(expected: number, receipts: readonly string[]) {
  const duplicates = receipts.length - new Set(receipts).size;
  return {
    pass: receipts.length === expected && duplicates === 0,
    expected,
    actual: receipts.length,
    duplicates,
  };
}
