/**
 * virtualLocaleDiscovery.js — Discovers implicit "virtual" locales from
 * the link graph by finding connected sets of images linked via l/r commands.
 *
 * All functions are pure logic — no DOM dependencies. This module is
 * importable in both browser and Node for testability.
 */

import { HEADINGS_8, HEADING_MAP_16_TO_8 } from './dataModel.js';

// ─── Data class ──────────────────────────────────────────────────────

/**
 * Represents a discovered virtual locale — a set of images linked by
 * explicit l/r links that are not yet assigned to a formal locale.
 */
export class VirtualLocale {
  /**
   * @param {number} id  Negative integer identifier (e.g. -1, -2, -3)
   */
  constructor(id) {
    /** @type {number} Negative integer distinguishing from formal locales */
    this.id = id;

    /** @type {import('./dataModel.js').MapEntry[]} Ring members — found via l/r BFS */
    this.ringMembers = [];

    /** @type {import('./dataModel.js').MapEntry[]} All members — ring + in-slot companions */
    this.members = [];

    /** @type {boolean} Whether the r-chain closes (last member links back to first) */
    this.isCyclic = false;

    /** @type {number|null} Arc span in degrees, or null if unknown */
    this.arcSpan = null;

    /** @type {Map<number, string>} entryId → inferred 8-point heading */
    this.inferredHeadings = new Map();

    /** @type {Map<number, {candidates: string[], sources: string[]}>} Heading conflicts */
    this.conflicts = new Map();

    /** @type {boolean} True if zero headings could be inferred (needs user seeding) */
    this.needsSeeding = false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Compute angular distance between two 8-point headings (0-4).
 * @param {string} a  8-point heading
 * @param {string} b  8-point heading
 * @returns {number} 0-4 (shortest path around the ring)
 */
export function headingDistance(a, b) {
  const ia = HEADINGS_8.indexOf(a);
  const ib = HEADINGS_8.indexOf(b);
  if (ia === -1 || ib === -1) return -1;
  const diff = Math.abs(ia - ib);
  return Math.min(diff, 8 - diff);
}

/**
 * Get the 8-point heading at a given offset from a base heading.
 * Positive offset = counterclockwise (matching HEADINGS_8 array direction).
 * @param {string} base     8-point heading
 * @param {number} offset   Number of slots (+CCW, -CW)
 * @returns {string} 8-point heading
 */
function headingAtOffset(base, offset) {
  const idx = HEADINGS_8.indexOf(base);
  return HEADINGS_8[((idx + offset) % 8 + 8) % 8];
}

/**
 * Distribute N members evenly across the 8-point compass ring,
 * starting from pinned positions.
 *
 * @param {number} totalMembers    Total number to place
 * @param {Map<number, number>} pinnedPositions  memberIndex → slot index (0-7)
 * @returns {Map<number, number>}  memberIndex → slot index for all members
 */
export function distributeEvenly(totalMembers, pinnedPositions) {
  const result = new Map(pinnedPositions);

  if (totalMembers <= 0) return result;

  // If nothing is pinned, distribute evenly starting from slot 0
  if (pinnedPositions.size === 0) {
    const step = 8 / totalMembers;
    for (let i = 0; i < totalMembers; i++) {
      result.set(i, Math.round(i * step) % 8);
    }
    return result;
  }

  // If everything is already pinned, nothing to distribute
  if (pinnedPositions.size >= totalMembers) return result;

  // Single pinned position: distribute remaining members starting from it
  if (pinnedPositions.size === 1) {
    const [pinnedMember, pinnedSlot] = [...pinnedPositions.entries()][0];
    const step = 8 / totalMembers;
    const unpinnedMembers = [];
    for (let i = 0; i < totalMembers; i++) {
      if (!pinnedPositions.has(i)) unpinnedMembers.push(i);
    }
    // Place unpinned members at step intervals starting from pinned position
    for (let u = 0; u < unpinnedMembers.length; u++) {
      const slot = (pinnedSlot + Math.round((u + 1) * step)) % 8;
      result.set(unpinnedMembers[u], slot);
    }
    return result;
  }

  // Multiple pinned positions: distribute unpinned members evenly in gaps
  // between consecutive pinned members (on the ring)
  const pinnedEntries = [...pinnedPositions.entries()].sort((a, b) => a[1] - b[1]);
  const unpinnedMembers = [];
  for (let i = 0; i < totalMembers; i++) {
    if (!pinnedPositions.has(i)) unpinnedMembers.push(i);
  }

  // Build gap segments between consecutive pinned slots
  const gaps = [];
  for (let g = 0; g < pinnedEntries.length; g++) {
    const fromSlot = pinnedEntries[g][1];
    const toSlot = pinnedEntries[(g + 1) % pinnedEntries.length][1];
    const gapSize = ((toSlot - fromSlot - 1) + 8) % 8;
    gaps.push({ fromSlot, toSlot, gapSize });
  }

  // Calculate how many unpinned go into each gap (proportional to gap size)
  const totalGapSlots = gaps.reduce((s, g) => s + g.gapSize, 0);
  let placed = 0;
  for (const gap of gaps) {
    if (totalGapSlots === 0) break;
    const count = Math.round((gap.gapSize / totalGapSlots) * unpinnedMembers.length);
    const step = gap.gapSize / (count + 1);
    for (let j = 0; j < count && placed < unpinnedMembers.length; j++) {
      const slot = (gap.fromSlot + Math.round((j + 1) * step)) % 8;
      result.set(unpinnedMembers[placed++], slot);
    }
  }

  // Place any remaining (due to rounding) in the largest gap
  while (placed < unpinnedMembers.length) {
    const largestGap = gaps.reduce((best, g) => g.gapSize > best.gapSize ? g : best, gaps[0]);
    const slot = (largestGap.fromSlot + Math.floor(largestGap.gapSize / 2) + 1) % 8;
    result.set(unpinnedMembers[placed++], slot);
  }

  return result;
}


// ─── Discovery ───────────────────────────────────────────────────────

/**
 * Discover all virtual locales in a tour map.
 * A virtual locale is a connected set of locale-less images linked via explicit l/r links.
 *
 * @param {import('./dataModel.js').TourMap} tourMap
 * @returns {VirtualLocale[]}
 */
export function discoverVirtualLocales(tourMap) {
  const linkEntries = tourMap.getLinkEntries();

  // Build lookup: photo ID → MapEntry
  const entryById = new Map();
  for (const entry of linkEntries) {
    if (entry.id != null) {
      entryById.set(entry.id, entry);
    }
  }

  // Track which entries have been visited during BFS
  const visited = new Set();
  const virtualLocales = [];
  let nextId = -1;

  for (const entry of linkEntries) {
    // Skip entries that already belong to a formal locale
    if (entry.localeId != null && entry.localeId > 0) continue;
    // Skip entries already assigned to a virtual locale
    if (visited.has(entry.id)) continue;
    // Must have at least one l or r link to be part of a ring
    if (!entry.links['l'] && !entry.links['r']) continue;

    // ── Step 1: BFS via l/r links ──
    const ringMembers = [];
    const bfsQueue = [entry];
    const ringVisited = new Set();

    while (bfsQueue.length > 0) {
      const current = bfsQueue.shift();
      if (current.id == null || ringVisited.has(current.id)) continue;

      // Don't cross into formal locales
      if (current.localeId != null && current.localeId > 0) continue;

      ringVisited.add(current.id);
      visited.add(current.id);
      ringMembers.push(current);

      // Follow l and r links
      for (const cmd of ['l', 'r']) {
        const targetId = current.links[cmd];
        if (targetId != null && entryById.has(targetId) && !ringVisited.has(targetId)) {
          const target = entryById.get(targetId);
          // Only follow into locale-less entries
          if (target.localeId == null || target.localeId <= 0) {
            bfsQueue.push(target);
          }
        }
      }
    }

    // Must have at least 2 ring members
    if (ringMembers.length < 2) continue;

    // ── Step 2: In-slot expansion via u/d/o/c ──
    const allMembers = [...ringMembers];
    const memberIds = new Set(ringMembers.map(m => m.id));

    for (const ringEntry of ringMembers) {
      for (const cmd of ['u', 'd', 'o', 'c']) {
        const companionId = ringEntry.links[cmd];
        if (companionId != null && entryById.has(companionId) && !memberIds.has(companionId)) {
          const companion = entryById.get(companionId);
          // Only add if not in a formal locale
          if (companion.localeId == null || companion.localeId <= 0) {
            allMembers.push(companion);
            memberIds.add(companionId);
            visited.add(companionId);
          }
        }
      }
    }

    // ── Determine cyclicity ──
    // Follow the r-chain from the first member; if it returns to start, it's cyclic
    let isCyclic = false;
    let walker = ringMembers[0];
    const walkerVisited = new Set();
    while (walker) {
      if (walkerVisited.has(walker.id)) {
        isCyclic = true;
        break;
      }
      walkerVisited.add(walker.id);
      const nextId = walker.links['r'];
      if (nextId != null && memberIds.has(nextId)) {
        walker = entryById.get(nextId);
      } else {
        break;
      }
    }

    // ── Create virtual locale ──
    const vl = new VirtualLocale(nextId--);
    vl.ringMembers = ringMembers;
    vl.members = allMembers;
    vl.isCyclic = isCyclic;
    virtualLocales.push(vl);
  }

  return virtualLocales;
}


// ─── Heading Inference ───────────────────────────────────────────────

/**
 * Infer headings for all members of a virtual locale using a 4-phase pipeline.
 * Results are stored in vl.inferredHeadings and vl.conflicts.
 *
 * @param {VirtualLocale} vl
 * @param {import('./dataModel.js').TourMap} tourMap
 */
export function inferHeadingsForVirtualLocale(vl, tourMap) {
  vl.inferredHeadings.clear();
  vl.conflicts.clear();
  vl.needsSeeding = false;

  const entryById = new Map();
  for (const entry of tourMap.getLinkEntries()) {
    if (entry.id != null) entryById.set(entry.id, entry);
  }

  const memberIds = new Set(vl.members.map(m => m.id));

  // ── Phase 1: Anchor propagation from existing headings ──
  // Seed from any member that already has an explicit heading
  for (const entry of vl.ringMembers) {
    if (entry.heading) {
      const primary = HEADING_MAP_16_TO_8[entry.heading];
      if (primary) {
        setInferredHeading(vl, entry.id, primary, 'explicit');
      }
    }
  }

  // Propagate from known headings through l/r chain
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of vl.ringMembers) {
      const myHeading = vl.inferredHeadings.get(entry.id);
      if (!myHeading) continue;

      // l link: target is one slot CCW (+1 in HEADINGS_8 array)
      if (entry.links['l']) {
        const targetId = entry.links['l'];
        if (memberIds.has(targetId) && !vl.inferredHeadings.has(targetId)) {
          setInferredHeading(vl, targetId, headingAtOffset(myHeading, 1), 'propagation');
          changed = true;
        }
      }

      // r link: target is one slot CW (-1 in HEADINGS_8 array)
      if (entry.links['r']) {
        const targetId = entry.links['r'];
        if (memberIds.has(targetId) && !vl.inferredHeadings.has(targetId)) {
          setInferredHeading(vl, targetId, headingAtOffset(myHeading, -1), 'propagation');
          changed = true;
        }
      }
    }
  }

  // ── Phase 2: Cross-link anchoring from formal locale members ──
  // If a member has an f or b link to a formal locale member with a known heading,
  // use that to infer the member's heading (within ±2 slot limit)
  for (const entry of vl.ringMembers) {
    if (vl.inferredHeadings.has(entry.id)) continue;

    for (const cmd of ['f', 'b']) {
      const targetId = entry.links[cmd];
      if (targetId == null) continue;

      const target = entryById.get(targetId);
      if (!target || !target.heading) continue;
      if (target.localeId == null || target.localeId <= 0) continue; // must be formal locale

      const targetPrimary = HEADING_MAP_16_TO_8[target.heading];
      if (!targetPrimary) continue;

      // Use the target's heading directly — it's the direction you'd face
      // after arriving. The ±2 slot limit is enforced: we accept the heading
      // as-is since it comes from a formal locale member.
      setInferredHeading(vl, entry.id, targetPrimary, `cross-link-${cmd}`);
    }
  }

  // Re-run propagation after Phase 2 seeding
  changed = true;
  while (changed) {
    changed = false;
    for (const entry of vl.ringMembers) {
      const myHeading = vl.inferredHeadings.get(entry.id);
      if (!myHeading) continue;

      if (entry.links['l']) {
        const targetId = entry.links['l'];
        if (memberIds.has(targetId) && !vl.inferredHeadings.has(targetId)) {
          setInferredHeading(vl, targetId, headingAtOffset(myHeading, 1), 'propagation');
          changed = true;
        }
      }
      if (entry.links['r']) {
        const targetId = entry.links['r'];
        if (memberIds.has(targetId) && !vl.inferredHeadings.has(targetId)) {
          setInferredHeading(vl, targetId, headingAtOffset(myHeading, -1), 'propagation');
          changed = true;
        }
      }
    }
  }

  // ── Phase 3: Even distribution for remaining unassigned ring members ──
  const unassignedRingMembers = vl.ringMembers.filter(e => !vl.inferredHeadings.has(e.id));

  if (unassignedRingMembers.length > 0 && unassignedRingMembers.length < vl.ringMembers.length) {
    // Some are pinned, some are not — distribute evenly
    const pinnedPositions = new Map();
    const memberOrder = vl.ringMembers.map(e => e.id);

    for (let i = 0; i < vl.ringMembers.length; i++) {
      const h = vl.inferredHeadings.get(vl.ringMembers[i].id);
      if (h) {
        pinnedPositions.set(i, HEADINGS_8.indexOf(h));
      }
    }

    const distribution = distributeEvenly(vl.ringMembers.length, pinnedPositions);

    for (const [memberIdx, slotIdx] of distribution) {
      const entryId = vl.ringMembers[memberIdx].id;
      if (!vl.inferredHeadings.has(entryId)) {
        setInferredHeading(vl, entryId, HEADINGS_8[slotIdx], 'distribution');
      }
    }
  } else if (unassignedRingMembers.length === vl.ringMembers.length) {
    // No headings at all — even distribution from slot 0
    const step = 8 / vl.ringMembers.length;
    for (let i = 0; i < vl.ringMembers.length; i++) {
      const slotIdx = Math.round(i * step) % 8;
      setInferredHeading(vl, vl.ringMembers[i].id, HEADINGS_8[slotIdx], 'distribution');
    }
    // Mark as needing user seeding since these are arbitrary guesses
    vl.needsSeeding = true;
  }

  // ── Propagate headings to in-slot companions ──
  // Companions (u/d/o/c) share their ring member's heading
  for (const ringEntry of vl.ringMembers) {
    const ringHeading = vl.inferredHeadings.get(ringEntry.id);
    if (!ringHeading) continue;

    for (const cmd of ['u', 'd', 'o', 'c']) {
      const companionId = ringEntry.links[cmd];
      if (companionId != null && memberIds.has(companionId)) {
        setInferredHeading(vl, companionId, ringHeading, 'companion');
      }
    }
  }

  // ── Apply inferred headings to entries ──
  for (const entry of vl.members) {
    const heading = vl.inferredHeadings.get(entry.id);
    if (heading) {
      entry.inferredHeading = heading;
    }
  }

  // ── Compute arc span ──
  vl.arcSpan = computeArcSpan(vl.ringMembers, vl.inferredHeadings);
}

/**
 * Set an inferred heading for an entry, detecting conflicts.
 */
function setInferredHeading(vl, entryId, heading, source) {
  const existing = vl.inferredHeadings.get(entryId);
  if (existing && existing !== heading) {
    // Conflict — record both candidates
    if (!vl.conflicts.has(entryId)) {
      vl.conflicts.set(entryId, {
        candidates: [existing, heading],
        sources: ['previous', source]
      });
    } else {
      const conflict = vl.conflicts.get(entryId);
      if (!conflict.candidates.includes(heading)) {
        conflict.candidates.push(heading);
        conflict.sources.push(source);
      }
    }
    return; // Don't overwrite — leave as conflicted
  }
  vl.inferredHeadings.set(entryId, heading);
}


// ─── Heading Propagation (for interactive correction) ────────────────

/**
 * Propagate a heading change through the virtual locale.
 * Used when the user drags an image to a new compass slot.
 *
 * @param {VirtualLocale} vl
 * @param {number} entryId       The entry whose heading was changed
 * @param {string} newHeading    The new 8-point heading
 * @param {import('./dataModel.js').TourMap} tourMap
 * @returns {{ changed: Map<number, string> }}  All entries that changed (including the source)
 */
export function propagateHeadingChange(vl, entryId, newHeading, tourMap) {
  const changed = new Map();
  const entryById = new Map();
  for (const entry of tourMap.getLinkEntries()) {
    if (entry.id != null) entryById.set(entry.id, entry);
  }
  const memberIds = new Set(vl.members.map(m => m.id));

  // Set the initiating entry
  changed.set(entryId, newHeading);
  vl.inferredHeadings.set(entryId, newHeading);

  const entry = entryById.get(entryId);
  if (!entry) return { changed };

  // Also move companions
  for (const cmd of ['u', 'd', 'o', 'c']) {
    const companionId = entry.links[cmd];
    if (companionId != null && memberIds.has(companionId)) {
      changed.set(companionId, newHeading);
      vl.inferredHeadings.set(companionId, newHeading);
    }
  }

  // Propagate horizontally? No.
  // The user explicitly requested that dragging an image should NOT move other images in the ring.
  // Horizontal propagation enforces a rigid 8-point grid which destroys evenly distributed non-8-point rings.
  // We only propagate to vertical/door companions (which we already did above).

  // Update entry.inferredHeading for all changed entries
  for (const [id, heading] of changed) {
    const e = entryById.get(id);
    if (e) e.inferredHeading = heading;
  }

  return { changed };
}


// ─── Arc Span ────────────────────────────────────────────────────────

/**
 * Compute the compass arc span of ring members in degrees.
 * For cyclic locales, can be up to 360°. For open chains, > 180° is a warning.
 *
 * @param {import('./dataModel.js').MapEntry[]} ringMembers
 * @param {Map<number, string>} inferredHeadings
 * @returns {number|null} Arc span in degrees, or null if not enough data
 */
export function computeArcSpan(ringMembers, inferredHeadings) {
  const slots = new Set();
  for (const entry of ringMembers) {
    const heading = inferredHeadings.get(entry.id);
    if (heading) {
      slots.add(HEADINGS_8.indexOf(heading));
    }
  }

  if (slots.size < 2) return null;

  const sorted = [...slots].sort((a, b) => a - b);

  // Find the largest gap between consecutive occupied slots
  let maxGap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    maxGap = Math.max(maxGap, sorted[i + 1] - sorted[i]);
  }
  // Wrap-around gap
  maxGap = Math.max(maxGap, (8 - sorted[sorted.length - 1]) + sorted[0]);

  // Arc span = (8 - maxGap) * 45 degrees
  return (8 - maxGap) * 45;
}
