/**
 * dataModel.js — Central data structures for the TourMapEditor
 *
 * TourMap: the entire map file in memory.
 * MapEntry: one logical entry (link line, locale, comment, title, prefix, or description).
 */

// All valid navigation link command letters (followed by a target photo ID)
export const NAV_LINK_COMMANDS = [
  'l', 'r', 'f', 'b', 'a', 'u', 'd', 'z',
  'o', 'c', 'n', 'p', 'q', 'w', 'e', 'j'
];

// Human-readable labels for each command
export const COMMAND_LABELS = {
  l: 'Left',
  r: 'Right',
  f: 'Forward',
  b: 'Back',
  a: 'Turn Around',
  u: 'Up',
  d: 'Down',
  z: 'Zoom In',
  o: 'Open',
  c: 'Close',
  n: 'Next',
  p: 'Previous',
  q: 'Shift Right',
  w: 'Shift Left',
  e: 'Earlier',
  j: 'Later'
};

// 16-point compass headings, ordered counterclockwise from N as in TourGen
export const HEADINGS = [
  'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW',
  'S', 'SSE', 'SE', 'ESE', 'E', 'ENE', 'NE', 'NNE'
];

// 8-point compass headings in counterclockwise order (matches HEADINGS ordering)
export const HEADINGS_8 = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];

// Opposite heading mapping for "turn around" (a) links
export const OPPOSITES = {
  'N': 'S', 'S': 'N',
  'NE': 'SW', 'SW': 'NE',
  'E': 'W', 'W': 'E',
  'SE': 'NW', 'NW': 'SE'
};

// Map 16-point headings to nearest 8-point heading
export const HEADING_MAP_16_TO_8 = {
  'N': 'N', 'NNE': 'N',
  'NE': 'NE', 'ENE': 'E',
  'E': 'E', 'ESE': 'E',
  'SE': 'SE', 'SSE': 'S',
  'S': 'S', 'SSW': 'S',
  'SW': 'SW', 'WSW': 'W',
  'W': 'W', 'WNW': 'W',
  'NW': 'NW', 'NNW': 'N'
};

/**
 * A single entry in the map file.
 */
export class MapEntry {
  constructor() {
    /** @type {'link'|'locale'|'comment'|'title'|'prefix'|'blank'} */
    this.type = 'blank';

    /** Original raw text line(s) — used for comments, title, prefix, blank */
    this.raw = '';

    // --- Link line fields ---
    /** @type {string|null} Photo ID (stored as string to preserve length/padding) */
    this.id = null;

    /** @type {string|null} Compass heading string (uppercase) e.g. 'N', 'SSE' */
    this.heading = null;

    /**
     * Navigation links: command letter → target ID.
     * Only populated nav commands are present.
     * @type {Object<string, number>}
     */
    this.links = {};

    /** @type {string|null} Custom image filename (from 'i' command, without quotes) */
    this.customImage = null;

    /** @type {boolean} Whether this view is the tour home ('y' command) */
    this.isHome = false;

    /**
     * External URL link (from 'x' command)
     * @type {{ url: string, label: string }|null}
     */
    this.externalUrl = null;

    /**
     * User-defined link (from '=' command)
     * @type {{ label: string, targetId: number }|null}
     */
    this.userDefined = null;

    /** @type {string} Primary description (displayed above image) */
    this.description = '';

    /** @type {string} Additional verbose description (displayed below image) */
    this.verboseDescription = '';

    /** @type {number|null} Locale ID this link belongs to (-1 means none) */
    this.localeId = null;

    /** @type {string} Locale description text (inherited from preceding $ line) */
    this.localeDescription = '';

    // --- Locale fields ---
    /** @type {string} Locale header description (for type==='locale') */
    this.localeText = '';

    /**
     * Auto-computed links (e.g. { l: 710, r: 717, a: 713 })
     * @type {Object<string, number>}
     */
    this.autoLinks = {};

    /** @type {string|null} Inferred compass heading — not serialized, used during virtual locale formalization */
    this.inferredHeading = null;

    /** @type {string[]} Tokens that don't match known commands */
    this.unsupportedTokens = [];

    /** @type {string} Original raw text for round-trip fidelity */
    this.raw = '';
  }

  /**
   * Called when a property is changed via the visual UI.
   * Clears the raw text cache so the line will be re-serialized.
   */
  markModified() {
    this.raw = '';
  }
}


/**
 * The entire map file in memory.
 */
export class TourMap {
  constructor() {
    /** @type {string} Tour title (aggregated from ! lines) */
    this.title = '';

    /** @type {string} Current filename prefix (from + line or default) */
    this.filenamePrefix = '';
    
    /** @type {number} Digit padding for IDs in filenames (e.g. 4 for 0710) */
    this.idPadding = 0;

    /** @type {MapEntry[]} Ordered list of all entries */
    this.entries = [];

    /** @type {Set<Function>} Change listeners */
    this._listeners = new Set();
  }

  /**
   * Subscribe to changes.
   * @param {Function} fn - callback(changeType, data)
   */
  onChange(fn) {
    this._listeners.add(fn);
  }

  /**
   * Unsubscribe from changes.
   * @param {Function} fn
   */
  offChange(fn) {
    this._listeners.delete(fn);
  }

  /**
   * Notify all listeners of a change.
   * @param {string} changeType
   * @param {*} data
   */
  _notify(changeType, data) {
    for (const fn of this._listeners) {
      try { fn(changeType, data); } catch (e) { console.error(e); }
    }
  }

  /** @returns {string} */
  getNextId() {
    const ids = this.getLinkEntries()
      .map(e => parseInt(e.id, 10))
      .filter(id => !isNaN(id));
    const max = ids.length > 0 ? Math.max(...ids) : 0;
    return String(max + 1);
  }

  /** @returns {number} */
  getNextLocaleId() {
    const ids = this.entries
      .filter(e => e.type === 'locale')
      .map(e => e.localeId)
      .filter(id => id !== null);
    const max = ids.length > 0 ? Math.max(...ids) : -1;
    return max + 1;
  }

  /**
   * Get all link-type entries.
   * @returns {MapEntry[]}
   */
  getLinkEntries() {
    return this.entries.filter(e => e.type === 'link');
  }

  /**
   * Find a link entry by photo ID.
   * @param {string} id
   * @returns {MapEntry|undefined}
   */
  findById(id) {
    return this.entries.find(e => e.type === 'link' && e.id === id);
  }

  /**
   * Get the image filename for a given link entry.
   * Uses customImage if set, otherwise prefix + id + .jpg
   * @param {MapEntry} entry
   * @returns {string}
   */
  getImageFilename(entry) {
    if (entry.customImage) {
      let filename = entry.customImage.replace(/\\/g, '/');

      // Directory prefix case: e.g. "history/"
      if (filename.endsWith('/')) {
        const idStr = entry.id !== null ? String(entry.id) : '';
        if (idStr) {
          return filename + this.filenamePrefix + idStr + '.jpg';
        }
      }

      // Check for missing extension on the basename
      const lastSlash = filename.lastIndexOf('/');
      const lastDot = filename.lastIndexOf('.');
      if (lastDot <= lastSlash) {
        filename += '.jpg';
      }
      return filename;
    }

    if (entry.id !== null) {
      // Pad numeric-looking IDs if idPadding is set
      let idStr = String(entry.id);
      if (this.idPadding > 0 && /^\d+$/.test(idStr)) {
        idStr = idStr.padStart(this.idPadding, '0');
      }
      return this.filenamePrefix + idStr + '.jpg';
    }
    return '';
  }

  /**
   * Update an entry and notify listeners.
   * @param {number} index - index in entries array
   * @param {Partial<MapEntry>} changes
   */
  updateEntry(index, changes) {
    const entry = this.entries[index];
    if (!entry) return;
    Object.assign(entry, changes);
    this._notify('entryUpdated', { index, entry });
  }

  /**
   * Add a new entry at a given position.
   * @param {MapEntry} entry
   * @param {number} [index] — insert before this index; default = end
   */
  addEntry(entry, index) {
    if (index === undefined) {
      this.entries.push(entry);
    } else {
      this.entries.splice(index, 0, entry);
    }
    this._notify('entryAdded', { index: index ?? this.entries.length - 1, entry });
  }

  /**
   * Remove an entry by index.
   * @param {number} index
   */
  removeEntry(index) {
    const [removed] = this.entries.splice(index, 1);
    this._notify('entryRemoved', { index, entry: removed });
  }

  /**
   * Move an entry from one position to another.
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  moveEntry(fromIndex, toIndex) {
    const [entry] = this.entries.splice(fromIndex, 1);
    this.entries.splice(toIndex, 0, entry);
    this._notify('entryMoved', { fromIndex, toIndex, entry });
  }

  /**
   * Replace all data (e.g. after parsing a new file).
   * @param {{ title: string, filenamePrefix: string, entries: MapEntry[] }} data
   */
  replaceAll(data) {
    this.title = data.title || '';
    this.filenamePrefix = data.filenamePrefix || '';
    this.idPadding = data.idPadding || 0;
    this.entries = data.entries || [];
    this._notify('replaced', null);
  }

  /**
   * Group entries by locale for the auto-linker and locale editor.
   * @returns {{ localeId: number, description: string, entries: MapEntry[] }[]}
   */
  getLocaleGroups() {
    const groupsMap = new Map();

    for (const entry of this.entries) {
      if (entry.type === 'locale') {
        if (!groupsMap.has(entry.localeId)) {
          groupsMap.set(entry.localeId, {
            localeId: entry.localeId,
            description: entry.localeText || '',
            entries: []
          });
        } else {
          groupsMap.get(entry.localeId).description = entry.localeText || '';
        }
      } else if (entry.type === 'link' && entry.localeId !== null && entry.localeId !== -1) {
        if (!groupsMap.has(entry.localeId)) {
          groupsMap.set(entry.localeId, {
            localeId: entry.localeId,
            description: entry.localeDescription || '',
            entries: []
          });
        }
        groupsMap.get(entry.localeId).entries.push(entry);
      }
    }
    return Array.from(groupsMap.values());
  }

  /**
   * Get the locale group for a specific entry.
   * @param {MapEntry} entry
   * @returns {{ localeId: number, description: string, entries: MapEntry[] }|null}
   */
  getLocaleForEntry(entry) {
    if (entry.localeId === null || entry.localeId === -1) return null;
    const groups = this.getLocaleGroups();
    return groups.find(g => g.localeId === entry.localeId) || null;
  }

  /**
   * Gets the POV synchronization group for a given node, discovering it dynamically.
   * @param {string} id
   * @returns {{ siblings: string[], type: 'door'|'sequence'|'none', isLoose: boolean, isOpen: boolean, isClosed: boolean }|null}
   */
  /**
   * Gets the POV synchronization groups for a given node, discovering them dynamically.
   * @param {string} id
   * @returns {Array<{ siblings: string[], type: 'door'|'sequence', subtype?: 'np'|'ej'|'qw', isLoose: boolean, isOpen?: boolean, isClosed?: boolean }>}
   */
  getSyncGroupsForNode(id) {
    const entry = this.findById(id);
    if (!entry) return [];

    let groups = [];
    const isLoose = entry.unsupportedTokens.includes('*loose') || entry.unsupportedTokens.includes('+loose');

    // 1. Check for Door Pair
    let isOpen = false;
    let isClosed = false;
    let doorSibling = null;

    if (entry.links['o']) {
      const tgt = this.findById(entry.links['o']);
      if (tgt && tgt.links['c'] === id) {
        isClosed = true;
        doorSibling = tgt.id;
      }
    } else if (entry.links['c']) {
      const tgt = this.findById(entry.links['c']);
      if (tgt && tgt.links['o'] === id) {
        isOpen = true;
        doorSibling = tgt.id;
      }
    }

    if (doorSibling) {
      groups.push({
        siblings: [doorSibling],
        type: 'door',
        isLoose: false,
        isOpen,
        isClosed
      });
    }

    // Helper for BFS sequence discovery
    const findSequence = (cmdNext, cmdPrev, subtype) => {
      const seqSiblings = new Set();
      const queue = [entry];
      let groupIsLoose = isLoose;

      while (queue.length > 0) {
        const curr = queue.shift();
        if (curr.unsupportedTokens.includes('*loose') || curr.unsupportedTokens.includes('+loose')) {
          groupIsLoose = true;
        }

        [curr.links[cmdNext], curr.links[cmdPrev]].forEach(tId => {
          if (tId && tId !== id && !seqSiblings.has(tId)) {
            const t = this.findById(tId);
            if (t) {
               // Verify reciprocal
               if (t.links[cmdNext] === curr.id || t.links[cmdPrev] === curr.id) {
                 seqSiblings.add(tId);
                 queue.push(t);
               }
            }
          }
        });
      }

      if (seqSiblings.size > 0) {
        groups.push({
          siblings: Array.from(seqSiblings),
          type: 'sequence',
          subtype,
          isLoose: groupIsLoose,
          isOpen: false,
          isClosed: false
        });
      }
    };

    // 2. Check for Next/Prev Sequence
    findSequence('n', 'p', 'np');
    // 3. Check for Earlier/Later Sequence
    findSequence('e', 'j', 'ej');
    // 4. Check for Shift Sequence
    findSequence('q', 'w', 'qw');

    return groups;
  }

  /**
   * Safely updates a bidirectional/directional link and propagates it to sync groups.
   * Returns an array of synced sibling IDs that were modified.
   */
  updateLinkWithSync(entryId, command, targetId) {
    const entry = this.findById(entryId);
    if (!entry) return [];

    const groups = this.getSyncGroupsForNode(entryId);
    
    if (targetId === null) {
      delete entry.links[command];
    } else {
      entry.links[command] = targetId;
    }
    entry.markModified();

    // Commands that sync bidirectionally across all door/sequence members
    const symmetricalCommands = ['l', 'r', 'u', 'd', 'a', 'b'];
    // Commands that exist ONLY on the open member of a door pair (never the closed member)
    const DOOR_OPEN_ONLY = ['f', 'z'];
    const modifiedSiblings = [];

    // Propagate for each group independently
    for (const group of groups) {
      if (group.isLoose) continue;

      for (const sibId of group.siblings) {
        const sib = this.findById(sibId);
        if (!sib) continue;

        let shouldPropagate = false;

        // Sequence subtype propagation rules
        if (group.type === 'sequence') {
          if (group.subtype === 'qw') {
            // q/w shifts: only 'b' (the ESC action) is shared across the cluster.
            // All other commands (l, r, f, z, u, d) are per-member because each
            // shifted position is a distinct viewpoint with its own context.
            if (command === 'b') {
              shouldPropagate = true;
            }
          } else {
            // np sequences: 'f' (forward) is shared — all members go to the same
            // next destination. 'z' (zoom) is per-member — each step may zoom
            // to different content. 'b' is handled via the entry-point exception below.
            // ej sequences: same shared commands as np.
            const sharedCmds = ['l', 'r', 'u', 'd', 'a', 'f'];
            if (sharedCmds.includes(command)) {
              shouldPropagate = true;
            }
          }
        } else if (group.type === 'door') {
          if (DOOR_OPEN_ONLY.includes(command)) {
            // 'f' and 'z' belong ONLY to the open member.
            if (group.isClosed) {
              // We ARE the closed node — this command isn't allowed here.
              // Strip it from ourselves (defensive) and don't touch the sibling.
              delete entry.links[command];
              entry.markModified();
              shouldPropagate = false;
            } else {
              // We ARE the open node — this command is ours alone. Do NOT copy to closed.
              shouldPropagate = false;
            }
          } else if (symmetricalCommands.includes(command)) {
            // l, r, u, d, a, b always sync across both door states
            shouldPropagate = true;
          }
        }

        if (shouldPropagate) {
          if (targetId === null) {
            if (sib.links[command] !== undefined) {
               delete sib.links[command];
               sib.markModified();
               modifiedSiblings.push(sibId);
            }
          } else {
            if (command === 'b' && targetId === sib.id) {
               // Escape scenario: Do not mirror a 'b' link back onto the target it points to!
            } else if (sib.links[command] !== targetId) {
               sib.links[command] = targetId;
               sib.markModified();
               modifiedSiblings.push(sibId);
            }
          }
        }
      }
    }

    return modifiedSiblings;
  }
}
