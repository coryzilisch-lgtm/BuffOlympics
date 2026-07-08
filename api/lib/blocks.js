// Time-block constants — mirrored in the seed data (infra/migrations/001_init.sql)
// and in the bootstrap payload. `slot` is [startMinutes, endMinutes] since midnight;
// null slot = open play (never overlaps anything).
const BLOCKS = [
  { id: 'b130', label: '1:30 PM Rotation', time: '1:30 – 2:00 PM', slot: [810, 840], place: 'Courts · Lawn · Cafe' },
  { id: 'b200', label: '2:00 PM Rotation', time: '2:00 – 2:30 PM', slot: [840, 870], place: 'Lawn · Range · Lot' },
  { id: 'b230', label: '2:30 PM Rotation', time: '2:30 – 3:00 PM', slot: [870, 900], place: 'Lawn · Cafe · Lot' },
  { id: 'b300', label: '3:00 PM Rotation', time: '3:00 – 3:30 PM', slot: [900, 930], place: 'The Cafe' },
  { id: 'open', label: 'Open Play', time: 'Walk up anytime', slot: null, place: 'Cafe & Patio' },
];

function blockById(id) {
  return BLOCKS.find(b => b.id === id) || null;
}

function blockLabel(id) {
  const b = blockById(id);
  return b ? b.label : '';
}

// Two [start, end] slots overlap when each starts before the other ends.
// Either slot being null (open play) never overlaps.
function slotsOverlap(a, b) {
  if (!a || !b) return false;
  return a[0] < b[1] && b[0] < a[1];
}

module.exports = { BLOCKS, blockById, blockLabel, slotsOverlap };
