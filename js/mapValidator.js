/**
 * mapValidator.js — Audits a TourMap for data integrity issues.
 * Detects broken links, missing assets, and unsupported command codes.
 */

import { discoverVirtualLocales } from './virtualLocaleDiscovery.js';

export class MapValidator {
  /**
   * Performs a comprehensive validation of the TourMap.
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Map<string, string>} availableImages — filename -> objectURL map from ImageBrowser
   * @returns {Array<{type: 'error'|'warning', category: string, message: string, lineIndex: number, id?: number}>}
   */
  static validate(tourMap, availableImages) {
    const issues = [];
    const linkEntries = tourMap.getLinkEntries();
    const validIds = new Set(linkEntries.map(e => e.id));

    // Discover virtual locales for validation
    const virtualLocales = discoverVirtualLocales(tourMap);
    const vlByMemberId = new Map();
    virtualLocales.forEach(vl => {
      vl.members.forEach(m => vlByMemberId.set(m.id, vl));
    });

    const getLocaleGroupId = (entryId) => {
      const e = tourMap.findById(entryId);
      if (!e) return null;
      if (e.localeId != null && e.localeId > 0) return e.localeId;
      const vl = vlByMemberId.get(entryId);
      if (vl) return vl.id;
      return null;
    };

    const formatLocaleName = (id) => {
      if (!id) return 'Unassigned';
      return id > 0 ? `Formal #${id}` : `Virtual (Auto)`;
    };

    tourMap.entries.forEach((entry, index) => {
      if (entry.type !== 'link') return;

      // 1. Check for Unsupported Tokens
      if (entry.unsupportedTokens && entry.unsupportedTokens.length > 0) {
        const actualUnsupported = entry.unsupportedTokens.filter(t => t !== '*loose' && t !== '+loose');
        if (actualUnsupported.length > 0) {
          issues.push({
            type: 'warning',
            category: 'Command',
            message: `Unsupported tokens: ${actualUnsupported.join(', ')}`,
            lineIndex: index,
            id: entry.id
          });
        }
      }

      // 2. Check for Broken Navigation Links
      for (const cmd in entry.links) {
        const targetId = entry.links[cmd];
        if (!validIds.has(targetId)) {
          issues.push({
            type: 'error',
            category: 'Link',
            message: `Broken link '${cmd}': target ID #${targetId} not found`,
            lineIndex: index,
            id: entry.id
          });
        }
      }

      // 3. Check for User-defined Broken Links
      if (entry.userDefined && !validIds.has(entry.userDefined.targetId)) {
        issues.push({
          type: 'error',
          category: 'Link',
          message: `Broken User-Link: target ID #${entry.userDefined.targetId} not found`,
          lineIndex: index,
          id: entry.id
        });
      }

      // 4. Check for Missing Image Files
      if (availableImages && availableImages.size > 0) {
        const expectedFilename = tourMap.getImageFilename(entry);
        if (!this._isImageAvailable(expectedFilename, availableImages)) {
          issues.push({
            type: 'warning',
            category: 'Asset',
            message: `Missing image file: '${expectedFilename}'`,
            lineIndex: index,
            id: entry.id
          });
        }
      }

      // 5. Sequence Sync Consistency Check
      const groups = tourMap.getSyncGroupsForNode(entry.id);
      
      for (const group of groups) {
        if (group.type === 'sequence' && !group.isLoose) {
          // np/ej: 'f' (forward) is shared — all members in a next/prev or earlier/later
          // sequence share the same forward destination. 'z' (zoom) is per-member.
          // qw (shift): only 'b' (ESC) is checked — all other links are per-shifted-position.
          let directionalCmds;
          if (group.subtype === 'qw') {
            directionalCmds = ['b'];
          } else {
            directionalCmds = ['l', 'r', 'u', 'd', 'a', 'f', 'b'];
          }
          
          let hasConflict = false;
          let hasOmission = false;
          
          // We just compare ourselves with siblings. Since we iterate over all entries,
          // every item is checked against its siblings at least once.
          for (const sibId of group.siblings) {
            const sib = tourMap.findById(sibId);
            if (!sib) continue;
            
            for (const cmd of directionalCmds) {
               const myLink = entry.links[cmd];
               const sibLink = sib.links[cmd];
               
               // 'b' (back) exception: the entry-point member of the set may have a
               // different b link (e.g. pointing back to a pre-zoom view it was arrived
               // from), while all other members correctly point b to that entry member.
               // Valid patterns:
               //   myLink === sib.id  → I point back to sibling (sibling is entry point)
               //   sibLink === entry.id → sibling points back to me (I am entry point)
               //   one side has no b at all (original escape-chain case)
               if (cmd === 'b') {
                  if (myLink === sib.id || sibLink === entry.id) {
                     continue; // Valid: entry-point pattern
                  }
                  if ((myLink === sib.id && !sibLink) || (sibLink === entry.id && !myLink)) {
                     continue; // Valid: one-sided escape
                  }
               }
  
               if (myLink && sibLink && myLink !== sibLink) {
                  hasConflict = true;
               } else if ((myLink && !sibLink) || (!myLink && sibLink)) {
                  hasOmission = true;
               }
            }
            if (hasConflict) break;
          }
  
          if (hasConflict || hasOmission) {
            const category = hasConflict ? 'Sync Conflict' : 'Sync Omission';
            const shortDesc = hasConflict ? 'Conflicting sequence link targets across views.' : 'Missing expected sequence link across views.';
            const safeRaw = entry.raw || 'Unsaved edits...';
            const message = `${shortDesc}<br><span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); display: inline-block; margin-top: 4px;">[${index + 3}] ${safeRaw.substring(0, 60)}${safeRaw.length > 60 ? '...' : ''}</span>`;
            
            // Add a custom property so the UI can detect this and offer actions
            issues.push({
              type: 'warning',
              category: category,
              message: message,
              lineIndex: index,
              id: entry.id,
              actionData: { type: 'sequence_mismatch', subtype: group.subtype, groupId: group.siblings }
            });
          }
        }

        // 6. Door Sync Conflict Check
        // Detect when the closed member of a door pair has 'f' or 'z' links, which
        // are only valid on the open member.
        if (group.type === 'door') {
          const closedId = group.isClosed ? entry.id : group.siblings[0];
          const closedEntry = tourMap.findById(closedId);
          const closedIdx = closedEntry ? tourMap.entries.indexOf(closedEntry) : -1;
          if (closedEntry && closedIdx >= 0) {
            for (const cmd of ['f', 'z']) {
              if (closedEntry.links[cmd]) {
                const cmdLabel = cmd === 'f' ? 'Forward' : 'Zoom In';
                issues.push({
                  type: 'warning',
                  category: 'Door Sync Conflict',
                  message: `Closed-door #${closedId} has a '${cmdLabel}' link — this command is only valid on the open member.`,
                  lineIndex: closedIdx,
                  id: closedId,
                  actionData: { type: 'door_open_only_conflict', cmd, closedId, openId: group.isClosed ? group.siblings[0] : entry.id }
                });
              }
            }
          }
        }
      }

      // 7. Zoom State Constraint Check
      // A zoom state (entry that is targeted by a 'z' link) should not have lateral panning or forward/turn links.
      const isZoomState = tourMap.entries.some(e => e.type === 'link' && e.links['z'] === entry.id);
      if (isZoomState) {
        for (const cmd of ['l', 'r', 'f', 'a']) {
          if (entry.links[cmd]) {
            const isLoose = entry.unsupportedTokens && entry.unsupportedTokens.some(t => t === '*loose' || t === '+loose');
            if (!isLoose) {
              issues.push({
                type: 'warning',
                category: 'Zoom State Conflict',
                message: `Entry #${entry.id} is a zoom destination but has a '${cmd}' (lateral pan) link. Left/Right panning is unsupported in zoom state. Add * to suppress.`,
                lineIndex: index,
                id: entry.id,
                actionData: { type: 'zoom_lr_conflict', cmd }
              });
            }
          }
        }
      }

      // 8. q/w Shift + l/r Ambiguity Warning
      // If an entry is part of a shift cluster (has q or w links) but ALSO has
      // l or r links, flag it — in a zoomed/shifted context these likely conflict.
      // Suppress with *loose or +loose marker.
      if ((entry.links['q'] || entry.links['w']) && (entry.links['l'] || entry.links['r'])) {
        const isLoose = entry.unsupportedTokens &&
          entry.unsupportedTokens.some(t => t === '*loose' || t === '+loose');
        if (!isLoose) {
          issues.push({
            type: 'warning',
            category: 'Navigation Ambiguity',
            message: `Entry #${entry.id} has both shift (q/w) and directional (l/r) links. In a zoomed/shifted context, l/r may conflict with q/w navigation. Add * (loose marker) to suppress.`,
            lineIndex: index,
            id: entry.id,
            actionData: { type: 'nav_ambiguity' }
          });
        }
      }

      // 9. Open Door Reference Check
      // If any non-door-mechanism link (not 'o' or 'c') points to the OPEN member of a
      // door pair, the editor should be prompted to change it to the CLOSED member.
      // EXEMPTION: 'b' (back) is allowed to point to an open door, representing stepping backward through it.
      // Rationale: the nav-grid auto-redirects open→closed at runtime, but the stored
      // link target shows the open-door image in neighbor cells, which is misleading.
      // Suppressible with *loose or +loose.
      const isLooseEntry = entry.unsupportedTokens &&
        entry.unsupportedTokens.some(t => t === '*loose' || t === '+loose');
      if (!isLooseEntry) {
        for (const cmd in entry.links) {
          if (cmd === 'o' || cmd === 'c' || cmd === 'b') continue;
          const targetId = entry.links[cmd];
          const target = tourMap.findById(targetId);
          if (!target) continue;
          // Is the target the OPEN member of a verified door pair?
          // Open member = has a 'c' link, and the 'c' target has an 'o' pointing back.
          const closedId = target.links['c'];
          if (closedId) {
            const closedSibling = tourMap.findById(closedId);
            if (closedSibling && closedSibling.links['o'] === targetId) {
              issues.push({
                type: 'warning',
                category: 'Open Door Reference',
                message: `Link '${cmd}' on #${entry.id} points to open-door view #${targetId}. The closed-door view #${closedId} is the preferred target (or add * to suppress).`,
                lineIndex: index,
                id: entry.id,
                actionData: { type: 'open_door_ref', cmd, openId: targetId, closedId }
              });
            }
          }
        }
      }

      // 10. Cross-locale l/r/a Anomaly
      // Directional panning (l, r, a) implies turning around in the same physical location.
      // Therefore, they should never point to an image outside the current locale.
      if (!isLooseEntry) {
        for (const cmd of ['l', 'r', 'a']) {
          const targetId = entry.links[cmd];
          if (targetId && validIds.has(targetId)) {
            const myGroupId = getLocaleGroupId(entry.id);
            const targetGroupId = getLocaleGroupId(targetId);
            if (myGroupId !== targetGroupId && myGroupId !== null && targetGroupId !== null) {
              issues.push({
                type: 'warning',
                category: 'Cross-locale Anomaly',
                message: `Link '${cmd}' points outside the locale to #${targetId}. Directional panning should be contained within a single location. Add * to suppress.`,
                lineIndex: index,
                id: entry.id,
                actionData: { type: 'cross_locale_lr', cmd, targetId }
              });
            }
          }
        }
      }

      // 11. Split Door Pairs
      // Members of a door pair (o/c links) represent the same physical view with a door open/closed.
      // They must belong to the exact same locale.
      if (!isLooseEntry) {
        for (const cmd of ['o', 'c']) {
          const targetId = entry.links[cmd];
          if (targetId && validIds.has(targetId)) {
            const myGroupId = getLocaleGroupId(entry.id);
            const targetGroupId = getLocaleGroupId(targetId);
            if (myGroupId !== targetGroupId) {
              issues.push({
                type: 'warning',
                category: 'Split Door Pair',
                message: `Door pair is split across locales. #${entry.id} is in ${formatLocaleName(myGroupId)}, but partner #${targetId} is in ${formatLocaleName(targetGroupId)}. Add * to suppress.`,
                lineIndex: index,
                id: entry.id,
                actionData: { type: 'split_door', cmd, targetId }
              });
            }
          }
        }
      }
    });


    // Deduplicate Sync issues so we don't spam one per node in the sequence
    const dedupedIssues = [];
    const seenSequences = new Set();
    
    for (const is of issues) {
       if (is.category === 'Sync') {
         // Create a stable key from sorted siblings + subtype
         const allMembers = [is.id, ...is.actionData.groupId].map(i => String(i)).sort().join('_');
         const key = `${is.actionData.subtype}_${allMembers}`;
         if (seenSequences.has(key)) continue;
         seenSequences.add(key);
       }
       dedupedIssues.push(is);
    }
    
    return dedupedIssues;
  }

  /**
   * Helper to check image availability case-insensitively and via basename fallback.
   */
  static _isImageAvailable(filename, availableImages) {
    if (!filename) return false;
    
    // Exact or Case-insensitive match via direct lookup would require the ImageMapLower logic,
    // but we'll keep it simple by iterating if needed or assuming lowerKey match.
    const lowerFilename = filename.toLowerCase();
    
    // Check keys directly (assuming key might be full relative path)
    for (const key of availableImages.keys()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === lowerFilename) return true;
      // Basename fallback: if "DCP_1234.jpg" matches "images/DCP_1234.jpg"
      if (lowerKey.split('/').pop() === lowerFilename.split('/').pop()) return true;
    }

    return false;
  }
}
