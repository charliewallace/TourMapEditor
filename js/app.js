/**
 * app.js — Application entry point.
 * Initializes all modules, wires up events, manages file open/save.
 * Supports Chrome/Edge File System Access API with Firefox fallback.
 */

import { TourMap, MapEntry, COMMAND_LABELS, OPPOSITES, HEADING_MAP_16_TO_8 } from './dataModel.js';
import { parseMapFile } from './mapFileParser.js';
import { serializeMapFile } from './mapFileSerializer.js';
import { LineList } from './lineList.js';
import { NavGrid } from './navGrid.js';
import { ImageBrowser } from './imageBrowser.js';
import { PropertiesPanel } from './propertiesPanel.js';
import { RawLineEditor } from './rawLineEditor.js';
import { TextView } from './textView.js';
import { LocaleEditor } from './localeEditor.js';
import { computeAutoLinks } from './autoLinker.js';
import { MapValidator } from './mapValidator.js';
import { Wizard } from './wizard.js';
import { discoverVirtualLocales, inferHeadingsForVirtualLocale, propagateHeadingChange } from './virtualLocaleDiscovery.js';

// ---- Global Constants for Bidirectional Links ----
const OPPOSITE_CMDS = {
  'f': 'b', 'b': 'f',
  'l': 'r', 'r': 'l',
  'u': 'd', 'd': 'u',
  'n': 'p', 'p': 'n',
  'q': 'w', 'w': 'q',
  'e': 'j', 'j': 'e',
  'o': 'c', 'c': 'o',
  'a': 'a'
};

const OPPOSITE_HEADINGS = {
  'N': 'S', 'S': 'N',
  'E': 'W', 'W': 'E',
  'NE': 'SW', 'SW': 'NE',
  'NW': 'SE', 'SE': 'NW',
  'NNE': 'SSW', 'SSW': 'NNE',
  'ENE': 'WSW', 'WSW': 'ENE',
  'ESE': 'WNW', 'WNW': 'ESE',
  'SSE': 'NNW', 'NNW': 'SSE'
};

function showToast(message) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3500);
}

function inferHeading(sourceEntry, targetEntry, command) {
  if (!targetEntry.heading && sourceEntry && sourceEntry.heading) {
    const headings8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const h16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    
    if (command === 'f' || command === 'b') {
      targetEntry.heading = sourceEntry.heading;
      return true;
    } else if (command === 'l') {
       // Guess rotation left (Clockwise in our array order N, NNE, NE...)
       // Wait, HEADINGS in dataModel is N, NNW, NW... (Counter-clockwise)
       // Let's check HEADINGS in dataModel.js line 35.
       // 0:N, 1:NNW, 2:NW ...
       // So N -> NW is +2.
       const curH = sourceEntry.heading.toUpperCase();
       const hIndex = h16.indexOf(curH);
       if (hIndex !== -1) {
         // In h16, N is 0. NE is 2. E is 4.
         // Wait, h16 I wrote above is CW: N, NNE, NE...
         // Let's stick to the one in dataModel: 0:N, 1:NNW, 2:NW, 3:WNW, 4:W, 5:WSW, 6:SW, 7:SSW, 8:S, 9:SSE, 10:SE, 11:ESE, 12:E, 13:ENE, 14:NE, 15:NNE
         const currentIdx = [
           'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 
           'S', 'SSE', 'SE', 'ESE', 'E', 'ENE', 'NE', 'NNE'
         ].indexOf(curH);
         if (currentIdx !== -1) {
            // Left in CCW order is +2 (e.g. N -> NW)
            targetEntry.heading = [
              'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 
              'S', 'SSE', 'SE', 'ESE', 'E', 'ENE', 'NE', 'NNE'
            ][(currentIdx + 2) % 16];
            return true;
         }
       }
    } else if (command === 'r') {
       const curH = sourceEntry.heading.toUpperCase();
       const currentIdx = [
         'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 
         'S', 'SSE', 'SE', 'ESE', 'E', 'ENE', 'NE', 'NNE'
       ].indexOf(curH);
       if (currentIdx !== -1) {
          // Right in CCW order is -2 (e.g. N -> NE)
          targetEntry.heading = [
            'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 
            'S', 'SSE', 'SE', 'ESE', 'E', 'ENE', 'NE', 'NNE'
          ][(currentIdx - 2 + 16) % 16];
          return true;
       }
    } else if (command === 'a') {
      const opp = OPPOSITE_HEADINGS[sourceEntry.heading.toUpperCase()];
      if (opp) {
        targetEntry.heading = opp;
        return true;
      }
    }
  }
  return false;
}

function assignCustomImageIfNeeded(entry, imageName) {
  if (!imageName) return;
  const idStr = entry.id.toString().padStart(4, '0');
  const defaultName = tourMap.filenamePrefix + idStr + '.jpg';
  // Strip paths from imageName to compare exactly, though imageBrowser sends full paths if nested
  const basename = imageName.split('/').pop();
  if (basename !== defaultName || imageName.includes('/')) {
    entry.customImage = imageName;
  }
}

// ---- Global State ----
const tourMap = new TourMap();
let fileHandle = null;     // For Chrome save-in-place
let baseDirHandle = null;  // For auto-archiving logic
let selectedIndex = -1;
let isDirty = false;

// ---- Virtual Locale State ----
let virtualLocalesCache = [];       // VirtualLocale[] — cached discovery results
let virtualLocalesDirty = true;     // Recompute on next access
let showVirtualLocales = false;     // Toggle state (always starts off)
let activeVirtualLocale = null;     // VirtualLocale currently being formalized
let virtualLocaleUndoStack = [];    // For single-step undo during formalization

let returnContext = null;           // Stores state for the "leave and fix" workflow

/**
 * Recompute virtual locales from the current link graph.
 * Runs discovery + heading inference for all results, then caches.
 */
function recomputeVirtualLocales() {
  virtualLocalesCache = discoverVirtualLocales(tourMap);
  for (const vl of virtualLocalesCache) {
    inferHeadingsForVirtualLocale(vl, tourMap);
  }
  virtualLocalesDirty = false;
}

/**
 * Get the cached virtual locales, recomputing if needed.
 * @returns {import('./virtualLocaleDiscovery.js').VirtualLocale[]}
 */
function getVirtualLocales() {
  if (virtualLocalesDirty) {
    recomputeVirtualLocales();
  }
  return virtualLocalesCache;
}

/**
 * Display the "Return to..." banner with an action callback.
 */
function showReturnBanner(text, actionCallback, subtext = null) {
  const banner = document.getElementById('return-banner');
  const textEl = document.getElementById('return-banner-text');
  const subtextEl = document.getElementById('return-banner-subtext');
  const btnAction = document.getElementById('btn-return-action');
  const btnDismiss = document.getElementById('btn-return-dismiss');
  
  if (banner && textEl && btnAction && btnDismiss) {
    textEl.textContent = text;
    if (subtextEl) {
      if (subtext) {
        subtextEl.textContent = subtext;
        subtextEl.style.display = 'block';
      } else {
        subtextEl.style.display = 'none';
      }
    }
    btnAction.onclick = actionCallback;
    btnDismiss.onclick = hideReturnBanner;
    banner.classList.remove('hidden');
  }
}

/**
 * Hide the return banner and clear the context.
 */
function hideReturnBanner() {
  const banner = document.getElementById('return-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
  returnContext = null;
}

/**
 * Look up which virtual locale (if any) contains a given entry.
 * @param {number} entryId  Photo ID
 * @returns {import('./virtualLocaleDiscovery.js').VirtualLocale|null}
 */
function getVirtualLocaleForEntry(entryId) {
  const locales = getVirtualLocales();
  return locales.find(vl => vl.members.some(m => m.id === entryId)) || null;
}

// ---- Feature Detection ----
const supportsFileSystemAccess = ('showOpenFilePicker' in window);

// ---- UI Elements ----
const btnOpenMap = document.getElementById('btn-open-map');
const btnOpenImages = document.getElementById('btn-open-images');
const btnSave = document.getElementById('btn-save');
const btnSaveAs = document.getElementById('btn-save-as');
const btnAddLocale = document.getElementById('btn-add-locale');
const btnAddLine = document.getElementById('btn-add-line');
const btnDeleteLine = document.getElementById('btn-delete-line');
const btnToggleMode = document.getElementById('btn-toggle-mode');
const btnToggleVirtual = document.getElementById('btn-toggle-virtual');
const btnTextToggle = document.getElementById('btn-text-view');
const btnCheckout = document.getElementById('btn-checkout');
const btnCloseCheckout = document.getElementById('btn-close-checkout');
const btnDoneCheckout = document.getElementById('btn-done-checkout');
const btnFixAllOmissions = document.getElementById('btn-fix-all-omissions');
const btnCloseIssueDetails = document.getElementById('btn-close-issue-details');
const btnCancelIssueDetails = document.getElementById('btn-cancel-issue-details');
const issueCountEl = document.getElementById('issue-count');
const checkoutModal = document.getElementById('checkout-modal');
const issueDetailsModal = document.getElementById('issue-details-modal');
const checkoutResults = document.getElementById('checkout-results');
const virtualLocaleDrawer = document.getElementById('virtual-locale-drawer');
const virtualLocaleList = document.getElementById('virtual-locale-list');
const virtualLocaleCount = document.getElementById('virtual-locale-count');
const btnFormalizeAllVl = document.getElementById('btn-formalize-all-vl');
const navGridContainer = document.getElementById('nav-grid-container');
const localeEditorContainer = document.getElementById('locale-editor-container');
const fileInputMap = document.getElementById('file-input-map');
const fileInputImages = document.getElementById('file-input-images');
const inputPrefix = document.getElementById('input-prefix');
const inputDigits = document.getElementById('input-digits');

// ---- Initialize Modules ----
const lineList = new LineList(
  document.getElementById('line-list'),
  tourMap,
  onLineSelected
);

const imageBrowser = new ImageBrowser(
  document.getElementById('image-browser'),
  tourMap
);

const navGrid = new NavGrid(
  tourMap,
  onNavigateToPhoto,
  onLinkChanged,
  (photoId) => imageBrowser.getImageUrlById(photoId),
  onCycleHeading
);
navGrid.onPrimaryDrop = onPrimaryDrop;
// navGrid.onSetAsClosedDoor removed

const propertiesPanel = new PropertiesPanel(
  tourMap,
  onEntryPropertyChanged
);

const localeEditor = new LocaleEditor(
  tourMap,
  onNavigateToPhoto,
  onHeadingAssigned,
  (photoId) => imageBrowser.getImageUrlById(photoId),
  onConnectLocales
);
localeEditor.onLinkAsDoor = (idA, idB, currentIsB = false) => linkAsDoor(idA, idB, null, currentIsB);

const rawLineEditor = new RawLineEditor(
  tourMap,
  onRawLineEdited
);

const textView = new TextView(
  tourMap,
  onTextViewChanged
);

const wizard = new Wizard({
  onComplete: (config) => {
    tourMap.filenamePrefix = config.prefix;
    inputPrefix.value = config.prefix;
    const digits = parseInt(document.getElementById('wiz-digits-input').value, 10);
    tourMap.idPadding = isNaN(digits) ? 0 : digits;
    inputDigits.value = tourMap.idPadding;
    
    if (config.initialMode === 'locale') {
      onAddLocale();
      setMode('locale');
    } else {
      setMode('view');
    }
    markDirty();
    imageBrowser.render(); // Re-render to show updated IDs/used status
  },
  onCancel: () => {
    // Falls back to empty map
  }
});

inputPrefix.addEventListener('input', () => {
  tourMap.filenamePrefix = inputPrefix.value;
  markDirty();
  imageBrowser.render();
  refreshCurrentSelection();
});

inputDigits.addEventListener('input', () => {
  tourMap.idPadding = parseInt(inputDigits.value, 10) || 0;
  markDirty();
  imageBrowser.render();
  refreshCurrentSelection();
});

// ---- Event Wiring ----

let currentMode = 'view'; // 'view' or 'locale'

btnToggleMode.addEventListener('click', () => {
  const entry = selectedIndex >= 0 ? tourMap.entries[selectedIndex] : null;

  if (btnToggleMode.dataset.state === 'add') {
    // Delegate to onAddLocale() which will handle both virtual and raw views
    onAddLocale();
    
  } else {
    setMode(currentMode === 'view' ? 'locale' : 'view');
  }
});

btnToggleVirtual.addEventListener('click', () => {
  showVirtualLocales = !showVirtualLocales;
  if (showVirtualLocales) {
    btnToggleVirtual.classList.add('btn-toggle-active');
    virtualLocaleDrawer.classList.remove('hidden');
    btnToggleVirtual.disabled = true; // Temporary disable while loading
    setTimeout(() => {
      updateVirtualLocaleUI();
      btnToggleVirtual.disabled = false;
    }, 10); // allow UI to paint
  } else {
    btnToggleVirtual.classList.remove('btn-toggle-active');
    virtualLocaleDrawer.classList.add('hidden');
    lineList.showVirtualLocales = false;
    lineList.render();
  }
});

if (btnFormalizeAllVl) {
  btnFormalizeAllVl.addEventListener('click', formalizeAllVirtualLocales);
}

function updateVirtualLocaleUI() {
  if (!showVirtualLocales) return;
  
  const locales = getVirtualLocales();
  
  // Update LineList
  lineList.virtualLocales = locales;
  lineList.showVirtualLocales = true;
  lineList.onFormalizeVirtualLocale = (vl) => {
    previewVirtualLocale(vl);
  };
  lineList.render();
  
  // Update Drawer
  virtualLocaleCount.textContent = locales.length;
  virtualLocaleList.innerHTML = '';
  
  if (locales.length === 0) {
    virtualLocaleList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-tertiary); font-size: 11px;">No auto locales found.</div>';
    return;
  }
  
  locales.forEach(vl => {
    const row = document.createElement('div');
    row.className = 'virtual-locale-summary-row';
    
    let headingsCount = 0;
    vl.members.forEach(m => {
      if (vl.inferredHeadings && vl.inferredHeadings.has(m.id)) headingsCount++;
    });
    
    row.innerHTML = `
      <div class="vl-info">
        <span class="vl-id">Locale ${vl.id}</span>
        <span class="vl-meta">${vl.members.length} members · ${headingsCount} headings inferred</span>
      </div>
      <button class="vl-btn-formalize">Formalize</button>
    `;
    
    row.querySelector('.vl-btn-formalize').addEventListener('click', () => {
      previewVirtualLocale(vl);
    });
    
    virtualLocaleList.appendChild(row);
  });
}

function setMode(mode) {
  currentMode = mode;
  const entry = selectedIndex >= 0 ? tourMap.entries[selectedIndex] : null;

  if (mode === 'locale') {
    navGridContainer.classList.add('hidden');
    localeEditorContainer.classList.remove('hidden');
    btnToggleMode.innerHTML = '<span class="btn-icon">📷</span> View Mode';
    btnToggleMode.dataset.state = 'view'; // Reset state
    
    // Hide view-specific properties
    document.querySelectorAll('.view-only-prop').forEach(el => el.classList.add('hidden'));
  } else {
    // mode === 'view'
    if (activeVirtualLocale) {
      returnContext = { type: 'virtual_locale', vl: activeVirtualLocale };
      showReturnBanner('Return to Formalization', () => {
         previewVirtualLocale(returnContext.vl);
         hideReturnBanner();
      });

      activeVirtualLocale = null;
      virtualLocaleUndoStack = [];
    }
    
    localeEditorContainer.classList.add('hidden');
    navGridContainer.classList.remove('hidden');
    
    // Show view-specific properties
    document.querySelectorAll('.view-only-prop').forEach(el => el.classList.remove('hidden'));
    
    const isUnassignedLink = entry && entry.type === 'link' && (entry.localeId === null || entry.localeId === -1);
    if (isUnassignedLink) {
      btnToggleMode.innerHTML = '<span class="btn-icon">➕</span> Create Locale from Views';
      btnToggleMode.dataset.state = 'add';
    } else {
      btnToggleMode.innerHTML = '<span class="btn-icon">🧭</span> Locale Mode';
      btnToggleMode.dataset.state = 'locale';
    }
  }
  
  refreshCurrentSelection();
}


async function getFilesRecursively(dirHandle, path = '') {
  let files = [];
  for await (const entry of dirHandle.values()) {
    // FIX: Skip 'supercededMaps' directory to avoid loading archived maps or images
    if (entry.kind === 'directory' && entry.name === 'supercededMaps') {
      continue;
    }

    if (entry.kind === 'file') {
      const file = await entry.getFile();
      // Attach the relative path (with forward slashes)
      file.tourRelativePath = path + file.name;
      files.push(file);
    } else if (entry.kind === 'directory') {
      const subFiles = await getFilesRecursively(entry, path + entry.name + '/');
      files.push(...subFiles);
    }
  }
  return files;
}

async function handleOpenTourFolder() {
  if (!supportsFileSystemAccess) {
    alert("Your browser does not support the File System Access API required for auto-archiving. Please use a modern Chromium-based browser.");
    return;
  }
  
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    baseDirHandle = dirHandle;
    
    // Hide welcome screen, show main UI
    document.getElementById('welcome-screen').classList.add('hidden');
    document.getElementById('toolbar').classList.remove('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    
    const files = await getFilesRecursively(dirHandle);
    
    const candidates = files.filter(f => f.name.endsWith('.map') || f.name.endsWith('.js'));
    let mapFile = null;

    if (candidates.length > 0) {
      mapFile = candidates.find(f => f.name === 'tour_links.js');
      if (!mapFile) {
        mapFile = candidates.find(f => f.name === 'tour_links.map');
        if (!mapFile) {
          mapFile = candidates[0];
        }
      }
    }
    
    // Find the handle for the mapFile so we can save it later
    fileHandle = null;
    if (mapFile) {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name === mapFile.name) {
          fileHandle = entry;
          break;
        }
      }
    }
    
    // Load all images from this folder first
    imageBrowser.loadFromFileList(files);
    
    if (mapFile) {
      const text = await mapFile.text();
      loadMapFile(text);
      inputPrefix.value = tourMap.filenamePrefix || '';
    } else {
      console.warn("No map file found. Starting empty map.");
      loadMapFile('');
      if (files.length > 0) {
        wizard.start(files.map(f => f.name), baseDirHandle?.name);
      }
    }
    
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

document.getElementById('btn-start-tour').addEventListener('click', handleOpenTourFolder);
btnOpenMap.addEventListener('click', handleOpenTourFolder);

// Save
btnSave.addEventListener('click', async () => {
  let text = serializeMapFile({
    title: tourMap.title,
    filenamePrefix: tourMap.filenamePrefix,
    entries: tourMap.entries
  });

  // Always wrap in JS and save to tour_links.js
  text = `// Tour links definition:
var embeddedData = \`
${text}
\`;  //   REQUIRED closing single quote is at left!!`;

  if (supportsFileSystemAccess && baseDirHandle) {
    try {
      // 1. Check if we have an existing map file we should auto-archive
      if (fileHandle) {
        // Get or create supercededMaps directory
        const superHandle = await baseDirHandle.getDirectoryHandle('supercededMaps', { create: true });
        
        // Compute YYMMDD_HHMMSS
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const ts = `${yy}${mm}${dd}_${hh}${min}${ss}`;
        const archiveName = `${ts}_${fileHandle.name}`;
        
        // Read old content
        const oldFile = await fileHandle.getFile();
        const oldText = await oldFile.text();
        
        // Write to archive
        const archiveFileHandle = await superHandle.getFileHandle(archiveName, { create: true });
        const archiveWritable = await archiveFileHandle.createWritable();
        await archiveWritable.write(oldText);
        await archiveWritable.close();
      }

      // 2. Always write to tour_links.js
      fileHandle = await baseDirHandle.getFileHandle('tour_links.js', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      markClean();
    } catch (e) {
      console.error('Save failed:', e);
      downloadFile(text, 'tour_links.js');
    }
  } else {
    downloadFile(text, 'tour_links.js');
  }
});

// Save As
btnSaveAs.addEventListener('click', async () => {
  let text = serializeMapFile({
    title: tourMap.title,
    filenamePrefix: tourMap.filenamePrefix,
    entries: tourMap.entries
  });

  text = `// Tour links definition:
var embeddedData = \`
${text}
\`;  //   REQUIRED closing single quote is at left!!`;

  if (supportsFileSystemAccess) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'tour_links.js',
        types: [{
          description: 'JS Wrapper Files',
          accept: { 
            'text/javascript': ['.js'] 
          }
        }]
      });
      fileHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      markClean();
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
    }
  } else {
    downloadFile(text, 'tour_links.js');
  }
});

function onAddLocale() {
  if (!tourMap || !tourMap.entries) return;

  if (selectedIndex >= 0) {
    const currentEntry = tourMap.entries[selectedIndex];
    if (currentEntry.type === 'link') {
      const vl = getVirtualLocaleForEntry(currentEntry.id);
      if (vl) {
        previewVirtualLocale(vl);
        return;
      }
    }
  }
  
  const newLocaleId = tourMap.getNextLocaleId();
  const localeEntry = new MapEntry();
  localeEntry.type = 'locale';
  localeEntry.localeId = newLocaleId;
  localeEntry.localeDescription = `Locale ${newLocaleId}`;
  localeEntry.localeText = `Locale ${newLocaleId}`;

  let insertIdx = tourMap.entries.length;
  let hadLinkEntry = false;
  if (selectedIndex >= 0) {
    insertIdx = selectedIndex; // Insert BEFORE the selected item so it falls under it
    // Actually if we insert at selectedIndex, the old selected becomes selectedIndex+1
    const currentEntry = tourMap.entries[selectedIndex];
    if (currentEntry.type === 'link') {
      hadLinkEntry = true;
      // 1. Compute auto-links for the sweep
      computeAutoLinks(tourMap);

      // 2. BFS to find connected unassigned photos
      const members = [currentEntry];
      const queue = [currentEntry];
      const visited = new Set([currentEntry.id]);
      
      while (queue.length > 0) {
        const curr = queue.shift();
        // Only sweep in-place rotational commands (left, right, up, down, open, closed)
        // DO NOT sweep f (forward), b (back), n (next), p (prev) as they leave the physical spot
        ['l', 'r', 'u', 'd', 'o', 'c'].forEach(cmd => {
          const targetId = curr.links[cmd] || (curr.autoLinks ? curr.autoLinks[cmd] : null);
          if (targetId) {
            const target = tourMap.findById(targetId);
            if (target && target.localeId === null && !visited.has(targetId)) {
               visited.add(targetId);
               members.push(target);
               queue.push(target);
            }
          }
        });
      }

      console.log(`[Locale Sweep] Found ${members.length} members:`, members.map(m => m.id));

      // 3. Assign locale and move them
      // We want to insert them all after the new locale line.
      // Smallest original index in this set is where we'll put the locale line.
      const originalIndices = members.map(m => tourMap.entries.indexOf(m));
      const firstIdx = Math.min(...originalIndices);
      insertIdx = firstIdx;
      
      members.forEach(m => {
        m.localeId = newLocaleId;
        m.localeDescription = localeEntry.localeText;
        m.markModified();
      });

      // 4. If none of the swept members have a heading, auto-assign headings sequentially around the compass
      const hasAnyHeading = members.some(m => m.heading);
      if (!hasAnyHeading && members.length > 0) {
        // Find a starting point (e.g. currentEntry) and trace 'r' links to layout CCW
        const ordered = [];
        const seen = new Set();
        let curr = currentEntry;
        
        while (curr && !seen.has(curr.id)) {
          ordered.push(curr);
          seen.add(curr.id);
          const rightId = curr.links['r'] || (curr.autoLinks && curr.autoLinks['r']);
          curr = rightId ? members.find(m => m.id === rightId) : null;
        }
        
        // Pick up any stragglers not in the main 'r' loop
        members.forEach(m => {
          if (!seen.has(m.id)) ordered.push(m);
        });

        const headings8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        // Distribute them evenly over the 8 headings
        let step = Math.max(1, Math.floor(8 / ordered.length));
        if (ordered.length >= 8) step = 1;
        
        let hIdx = 0;
        ordered.forEach((m, i) => {
           if (i < 8) {
             m.heading = headings8[hIdx % 8];
             hIdx += step;
           } else {
             // If more than 8, just assign the nearest 16-point or fallback
             m.heading = 'N'; // Exceeds basic compass bounds, will stack
           }
        });
      }

      // 5. Move them all to be together at insertIdx + 1
      // We sort members by their original index to preserve their relative order if possible
      const originalIndicesLookup = new Map(members.map(m => [m.id, tourMap.entries.indexOf(m)]));
      members.sort((a, b) => originalIndicesLookup.get(a.id) - originalIndicesLookup.get(b.id));
      
      members.forEach((m, i) => {
        const currentIdx = tourMap.entries.indexOf(m);
        if (currentIdx !== insertIdx + 1 + i) {
          tourMap.moveEntry(currentIdx, insertIdx + 1 + i);
        }
      });
      
      // Update selectedIndex to the new position of the original currentEntry
      selectedIndex = tourMap.entries.indexOf(currentEntry);
    }
  }
  
  tourMap.addEntry(localeEntry, insertIdx);
  
  markDirty();
  lineList.render();
  if (hadLinkEntry) {
    // Reselect the photo (which moved forward by 1 due to the locale line shift)
    lineList.select(selectedIndex + 1);
  } else {
    // No link was selected, select the locale header itself
    lineList.select(insertIdx);
  }
  setMode('locale');
  runValidation();
}

/**
 * Creates a brand-new empty locale (no BFS sweep).
 * The user can then drag images into the rosette manually.
 * Always appends at the end so it doesn't displace entries from the current locale.
 */
function onNewEmptyLocale() {
  if (!tourMap || !tourMap.entries) return;

  const newLocaleId = tourMap.getNextLocaleId();
  const localeEntry = new MapEntry();
  localeEntry.type = 'locale';
  localeEntry.localeId = newLocaleId;
  localeEntry.localeDescription = `Locale ${newLocaleId}`;
  localeEntry.localeText = `Locale ${newLocaleId}`;

  // Always append at the end so we don't displace entries from the current locale
  const insertIdx = tourMap.entries.length;
  tourMap.addEntry(localeEntry, insertIdx);

  markDirty();
  lineList.render();
  // Select the newly created locale header
  lineList.select(insertIdx);
  setMode('locale');
  runValidation();
}

// Add new Locale (toolbar button creates an empty locale)
btnAddLocale.addEventListener('click', () => {
    onNewEmptyLocale();
});

btnCheckout.addEventListener('click', () => {
    showCheckoutReport();
});

btnCloseCheckout.addEventListener('click', () => checkoutModal.classList.add('hidden'));
btnDoneCheckout.addEventListener('click', () => checkoutModal.classList.add('hidden'));
btnCloseIssueDetails.addEventListener('click', () => issueDetailsModal.classList.add('hidden'));
btnCancelIssueDetails.addEventListener('click', () => issueDetailsModal.classList.add('hidden'));

btnFixAllOmissions.addEventListener('click', () => {
  const MAX_PASSES = 20;
  let totalFixed = 0;
  let passes = 0;

  // Helper: apply union-of-links fix to a single omission issue
  const fixOmissionGroup = (issue) => {
    const allIds = [issue.id, ...issue.actionData.groupId];
    // np/ej: 'f' (forward) is now synced across all members; 'z' (zoom) remains per-member
    let directionalCmds = ['l', 'r', 'u', 'd', 'a', 'f', 'b'];
    if (issue.actionData.subtype === 'qw') directionalCmds = ['b'];

    const unifiedLinks = {};
    allIds.forEach(id => {
      const e = tourMap.findById(id);
      if (e) {
        directionalCmds.forEach(cmd => {
          if (e.links[cmd] && unifiedLinks[cmd] === undefined) {
            unifiedLinks[cmd] = e.links[cmd];
          }
        });
      }
    });

    allIds.forEach(id => {
      const e = tourMap.findById(id);
      if (e) {
        directionalCmds.forEach(cmd => {
          if (unifiedLinks[cmd]) {
            if (cmd === 'b' && unifiedLinks[cmd] === e.id) return;
            e.links[cmd] = unifiedLinks[cmd];
          }
        });
        e.markModified();
      }
    });
  };

  // Loop until stable or max passes reached
  while (passes < MAX_PASSES) {
    passes++;
    // Re-validate to get fresh list each pass
    const currentIssues = MapValidator.validate(tourMap, imageBrowser.imageMap);
    window.lastValidationResults = currentIssues;

    const omissions = currentIssues.filter(i =>
      i.category === 'Sync Omission' && i.actionData && i.actionData.groupId
    );
    if (omissions.length === 0) break;

    // De-duplicate by group within this pass
    const seenGroups = new Set();
    omissions.forEach(issue => {
      const allIds = [issue.id, ...issue.actionData.groupId];
      const key = allIds.slice().sort().join('_') + '_' + issue.actionData.subtype;
      if (seenGroups.has(key)) return;
      seenGroups.add(key);
      fixOmissionGroup(issue);
      totalFixed++;
    });
  }

  // Final refresh
  runValidation();
  showCheckoutReport();
  refreshCurrentSelection();

  // Inject a prominent result banner at the top of the report
  const remaining = (window.lastValidationResults || []).filter(i => i.category === 'Sync Omission').length;
  const conflicts = (window.lastValidationResults || []).filter(i => i.category === 'Sync Conflict').length;
  const banner = document.createElement('div');
  banner.style.cssText = 'background: var(--bg-elevated); border-left: 4px solid var(--success, #48bb78); padding: 10px 14px; margin-bottom: 12px; border-radius: var(--radius-sm); font-size: 13px;';
  if (totalFixed > 0) {
    banner.innerHTML = `✅ Fixed <strong>${totalFixed}</strong> sync omission group${totalFixed !== 1 ? 's' : ''} in ${passes} pass${passes !== 1 ? 'es' : ''}.`
      + (conflicts > 0 ? ` <span style="color:var(--warning);">${conflicts} conflict${conflicts !== 1 ? 's' : ''} still require manual resolution — use the 🔧 Fix… button on each.</span>` : '')
      + (remaining > 0 ? ` <span style="color:var(--text-tertiary);">(${remaining} sync omission${remaining !== 1 ? 's' : ''} remain — try the 🔧 Fix… button on each for more detail.)</span>` : '');
  } else {
    banner.innerHTML = `ℹ️ No sync omissions to fix. (This button only addresses <em>Sync Omission</em> warnings — other warning types have their own action buttons in each row.)`;
  }
  if (checkoutResults.firstChild) {
    checkoutResults.insertBefore(banner, checkoutResults.firstChild);
  } else {
    checkoutResults.appendChild(banner);
  }
});

// Add new link line
btnAddLine.addEventListener('click', () => {
  const entry = new MapEntry();
  entry.type = 'link';

  entry.id = suggestNextId();

  // Insert after current selection, or at end
  const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : tourMap.entries.length;
  tourMap.addEntry(entry, insertAt);
  markDirty();
  lineList.render();
  lineList.select(insertAt);
  runValidation();
});

// Delete selected line
btnDeleteLine.addEventListener('click', () => {
  if (selectedIndex < 0) return;
  const entry = tourMap.entries[selectedIndex];
  if (!entry) return;

  // Confirm for link lines
  if (entry.type === 'link') {
    if (!confirm(`Delete link line #${entry.id}?`)) return;
  }

  const removedId = entry.id;
  tourMap.removeEntry(selectedIndex);

  // Strip all geometrical references pointing to this dead ID across the entire map
  if (entry.type === 'link' && removedId !== null) {
    tourMap.entries.forEach(e => {
      if (e.type === 'link') {
        Object.keys(e.links).forEach(cmd => {
          if (e.links[cmd] === removedId) {
            delete e.links[cmd];
          }
        });
      }
    });
  }

  markDirty();
  computeAutoLinks(tourMap);

  // Attempt to geometrically transition to an adjacent linked photo to prevent UI blackout
  let nextSelectedId = null;
  if (entry.type === 'link') {
    const adjacentCmds = ['l', 'r', 'f', 'b', 'u', 'd', 'n', 'p'];
    console.log(`[Delete] Transitioning from ID ${removedId}. Links:`, entry.links, "AutoLinks:", entry.autoLinks);

    // First pass: highly prefer staying within the exact same Locale
    for (const cmd of adjacentCmds) {
      const targetId = entry.links[cmd] !== undefined ? entry.links[cmd] : entry.autoLinks[cmd];
      if (targetId !== undefined) {
         const targetEntry = tourMap.findById(targetId);
         if (targetEntry && targetEntry.localeId === entry.localeId) {
           console.log(`[Delete] Found same-locale fallback via '${cmd}': ID ${targetId}`);
           nextSelectedId = targetId;
           break;
         }
      }
    }
    
    // Second pass: if isolated within Locale, allow cross-Locale link jump
    if (nextSelectedId === null) {
      for (const cmd of adjacentCmds) {
        const targetId = entry.links[cmd] !== undefined ? entry.links[cmd] : entry.autoLinks[cmd];
        if (targetId !== undefined) {
           console.log(`[Delete] Found cross-locale fallback via '${cmd}': ID ${targetId}`);
           nextSelectedId = targetId;
           break;
        }
      }
    }
  }

  if (nextSelectedId === null) console.log("[Delete] No geometric fallback found.");
  let newSelectIdx = -1;
  if (nextSelectedId !== null) {
    newSelectIdx = tourMap.entries.findIndex(e => e.type === 'link' && e.id === nextSelectedId);
  }

  // Fallback to array proximity if geometry isolated
  if (newSelectIdx < 0) {
    if (selectedIndex >= tourMap.entries.length) {
      selectedIndex = tourMap.entries.length - 1;
    }
    // Search backward for the nearest surviving link
    for (let i = selectedIndex; i >= 0; i--) {
       if (tourMap.entries[i].type === 'link') {
         newSelectIdx = i;
         break;
       }
    }
  }

  lineList.render();
  if (newSelectIdx >= 0) {
    lineList.select(newSelectIdx);
  } else {
    onLineSelected(selectedIndex >= 0 ? selectedIndex : -1);
  }
  runValidation();
});

// ---- Callbacks ----

function onLineSelected(index) {
  selectedIndex = index;
  const entry = index >= 0 ? tourMap.entries[index] : null;

  if (entry) {
    btnToggleMode.disabled = false;
    if (entry.type === 'locale' && currentMode !== 'locale') {
      setMode('locale');
      btnDeleteLine.disabled = index < 0;
      return;
    } else if (entry.type === 'link' && currentMode !== 'view') {
      setMode('view');
      btnDeleteLine.disabled = index < 0;
      return;
    } else {
      if (currentMode === 'view') {
        const isUnassignedLink = entry.type === 'link' && (entry.localeId === null || entry.localeId === -1);
        if (isUnassignedLink) {
          btnToggleMode.innerHTML = '<span class="btn-icon">➕</span> Create Locale from View';
          btnToggleMode.dataset.state = 'add';
        } else {
          btnToggleMode.innerHTML = '<span class="btn-icon">🧭</span> Locale Mode';
          btnToggleMode.dataset.state = 'locale';
        }
      } else {
        btnToggleMode.innerHTML = '<span class="btn-icon">📷</span> View Mode';
        btnToggleMode.dataset.state = 'view';
      }
    }
  } else {
    btnToggleMode.disabled = true;
  }

  refreshCurrentSelection();
  btnDeleteLine.disabled = index < 0;
}

function onNavigateToPhoto(photoId, fromCommand) {
  // --- Doors Default to Closed ---
  // If we're arriving at the OPEN member of a door pair via any command other
  // than 'o' (the explicit "Open" chip), redirect to the closed sibling instead.
  // This means navigating back to a door view always shows the closed state.
  if (fromCommand !== 'o') {
    const potentialOpen = tourMap.findById(photoId);
    if (potentialOpen && potentialOpen.links['c']) {
      const closedSibling = tourMap.findById(potentialOpen.links['c']);
      // Verify it's a true reciprocal door pair before redirecting
      if (closedSibling && closedSibling.links['o'] === photoId) {
        photoId = closedSibling.id;
      }
    }
  }

  const currentPhotoId = (selectedIndex >= 0 && tourMap.entries[selectedIndex].type === 'link') 
      ? tourMap.entries[selectedIndex].id 
      : null;

  // Find the entry index with this ID
  let idx = tourMap.entries.findIndex(e => e.type === 'link' && e.id === photoId);
  
  if (idx < 0) {
    // Auto-create missing photo to allow navigation (e.g. manually typed links or legacy mappings)
    const newEntry = new MapEntry();
    newEntry.type = 'link';
    newEntry.id = photoId;
    tourMap.addEntry(newEntry);
    idx = tourMap.entries.length - 1;
    markDirty();
  }

  // --- Auto-Stitch Missing Reverse Link & Heading on Navigation ---
  if (fromCommand && currentPhotoId !== null && idx >= 0) {
    const targetEntry = tourMap.entries[idx];
    const revCmd = OPPOSITE_CMDS[fromCommand];
    const currentEntry = tourMap.entries[selectedIndex];
    
    let changed = false;
    
    // Only auto-stitch if it's an explicit manual link, not an autoLink
    if (revCmd && currentEntry && currentEntry.links[fromCommand] === photoId) {
      // Guard: do not auto-stitch if targetEntry already links back to currentEntry
      // using ANY command. For example, if we arrived via an 'e' or 'z' link, 'b' acts
      // as an escape to return to the base image, so we shouldn't stitch 'f' on the base image.
      const alreadyLinkedBack = Object.keys(targetEntry.links).some(cmd => targetEntry.links[cmd] === currentEntry.id);
      
      if (!targetEntry.links[revCmd] && !alreadyLinkedBack) {
        // Guard: never auto-stitch 'f' (Forward) onto the closed member of a door pair.
        // 'f' is door-open-only — writing it to a closed door entry causes the
        // "Not Allowed" overlay to appear on its Forward cell.
        let blockStitch = false;
        if (revCmd === 'f') {
          const openId = targetEntry.links['o'];
          if (openId) {
            const openSibling = tourMap.findById(openId);
            if (openSibling && openSibling.links['c'] === targetEntry.id) {
              blockStitch = true; // targetEntry is verified closed door
            }
          }
        }
        if (!blockStitch) {
          targetEntry.links[revCmd] = currentPhotoId;
          changed = true;
        }
      }
    }
    
    if (inferHeading(currentEntry, targetEntry, fromCommand)) {
      changed = true;
    }
    
    if (changed) markDirty();
  }
  
  computeAutoLinks(tourMap);

  if (idx >= 0) {
    if (currentMode === 'locale') {
      setMode('view');
    }
    lineList.select(idx);
  }
  runValidation();
}

function onLinkChanged(command, targetId, imageName, customLabel = null) {
  if (selectedIndex < 0) return;
  const entry = tourMap.entries[selectedIndex];
  if (!entry || entry.type !== 'link') return;

  // Prevent self-linking
  if (targetId && targetId === entry.id) {
    showToast("Cannot link a photo to itself.");
    return;
  }

  if (targetId === null) {
    if (command === 'custom') {
      delete entry.userDefined;
    } else {
      delete entry.links[command];
    }
  } else {
    // If command is 'o' or 'c', use the door linking helper
    if (command === 'o' || command === 'c') {
      linkAsDoor(entry.id, targetId, imageName, command === 'c');
      return;
    }
    
    // If command is 'custom', store in userDefined
    if (command === 'custom') {
      entry.userDefined = { label: customLabel || 'Custom', targetId: targetId };
      entry.markModified();
      markDirty();
      navGrid.update(entry);
      rawLineEditor.update(selectedIndex);
      runValidation();
      return;
    }

    // Auto-create locally unlinked photo if missing
    let targetIdx = tourMap.entries.findIndex(e => e.type === 'link' && e.id === targetId);
    if (targetIdx < 0) {
      const newEntry = new MapEntry();
      newEntry.type = 'link';
      newEntry.id = targetId;
      assignCustomImageIfNeeded(newEntry, imageName);
      tourMap.addEntry(newEntry);
      targetIdx = tourMap.entries.length - 1;
    }
    
    tourMap.updateLinkWithSync(entry.id, command, targetId);

    // --- Bidirectional Auto-Linkage ---
    const targetEntry = tourMap.entries[targetIdx];
    let inferred = inferHeading(entry, targetEntry, command);
    
    // 1. Simple Reverse Link
    const revCmd = OPPOSITE_CMDS[command];
    if (revCmd && !targetEntry.links[revCmd]) {
      let allowReverse = true;
      if (allowReverse) {
        tourMap.updateLinkWithSync(targetEntry.id, revCmd, entry.id);
      }
    }

    // 2a. Zoom special case: auto-add 'b' (back/escape) on the zoom target.
    // OPPOSITE_CMDS doesn't include 'z' in the general table because the back
    // destination depends on whether the source is a door entry.
    // Rule: if zooming from the OPEN member of a door pair, point 'b' back to
    // the CLOSED sibling (avoids an Open Door Reference warning and is correct
    // semantics — ESC from zoom exits to the door-closed state). Otherwise,
    // point 'b' back to the source directly.
    if (command === 'z' && !targetEntry.links['b']) {
      const sourceGroups = tourMap.getSyncGroupsForNode(entry.id);
      const doorGroup = sourceGroups.find(g => g.type === 'door' && !g.isClosed);
      if (doorGroup) {
        // Source is the open member — back from zoom → closed sibling
        const closedId = entry.links['c'];
        if (closedId) {
          tourMap.updateLinkWithSync(targetEntry.id, 'b', closedId);
        } else {
          tourMap.updateLinkWithSync(targetEntry.id, 'b', entry.id);
        }
      } else {
        // Source is a normal (non-door) view
        tourMap.updateLinkWithSync(targetEntry.id, 'b', entry.id);
      }
    }

    // 2. Inter-Locale Stitching for 'f' (Forward)
    if (command === 'f' && entry.localeId !== null && targetEntry.localeId !== null && entry.localeId !== targetEntry.localeId) {
      if (targetEntry.heading) {
        const oppHeading = OPPOSITE_HEADINGS[targetEntry.heading.toUpperCase()];
        if (oppHeading) {
          const localeC = targetEntry.localeId;
          const localeD = entry.localeId;
          const groups = tourMap.getLocaleGroups();
          const groupC = groups.find(g => g.localeId === localeC);
          const groupD = groups.find(g => g.localeId === localeD);
          
          if (groupC && groupD) {
            const photoC_Opp = groupC.entries.find(e => e.heading && e.heading.toUpperCase() === oppHeading);
            const photoD_Opp = groupD.entries.find(e => e.heading && e.heading.toUpperCase() === oppHeading);

            if (photoC_Opp && photoD_Opp) {
              if (!photoC_Opp.links['f']) photoC_Opp.links['f'] = photoD_Opp.id;
            } else {
              const missingInC = !photoC_Opp ? `Locale #${localeC}` : '';
              const missingInD = !photoD_Opp ? `Locale #${localeD}` : '';
              const both = (missingInC && missingInD) ? `${missingInC} and ${missingInD}` : (missingInC || missingInD);
              showToast(`Incomplete inter-locale stitch: Missing ${oppHeading}-facing photo in ${both}.`);
            }
          }
        }
      }
    }

    // 3. Auto-Sync Shared Directional Links for New Sequence Members
    // If a new member was just added to an np or ej sequence, propagate the shared
    // directional links from the existing members to the new one (and vice versa)
    // so it doesn't immediately flag a sync omission warning.
    if (['n', 'p', 'e', 'j'].includes(command)) {
      const groups = tourMap.getSyncGroupsForNode(entry.id);
      for (const group of groups) {
        if (group.type === 'sequence' && !group.isLoose && (group.subtype === 'np' || group.subtype === 'ej')) {
          const sharedCmds = ['l', 'r', 'u', 'd', 'a', 'f'];
          const unionLinks = {};
          const allIds = [entry.id, ...group.siblings];
          
          // Collect union of all shared links across the sequence
          allIds.forEach(id => {
            const member = tourMap.findById(id);
            if (member) {
              sharedCmds.forEach(cmd => {
                if (member.links[cmd] && !unionLinks[cmd]) {
                  unionLinks[cmd] = member.links[cmd];
                }
              });
            }
          });
          
          // Apply union to all members directly
          allIds.forEach(id => {
            const member = tourMap.findById(id);
            if (member) {
              sharedCmds.forEach(cmd => {
                if (unionLinks[cmd] && member.links[cmd] !== unionLinks[cmd]) {
                  // updateLinkWithSync will also double-check and propagate, but starting 
                  // it on the specific member guarantees it gets the link.
                  tourMap.updateLinkWithSync(member.id, cmd, unionLinks[cmd]);
                }
              });
            }
          });
        }
      }
    }
  }

  if (entry) entry.markModified();
  markDirty();
  navGrid.update(entry);
  rawLineEditor.update(selectedIndex);
  runValidation();
}

/**
 * Links two photos as a door (Open/Closed).
 * @param {string} idA - Current photo ID
 * @param {string} idB - Target photo ID
 * @param {string} imageNameB - Optional image name for target
 * @param {boolean} currentIsB - If true, idA is the 'Open' state and idB is the 'Closed' state (reverse drop)
 */
function linkAsDoor(idA, idB, imageNameB = null, currentIsB = false) {
  if (idA === idB) return; // Prevent self-linking

  const entryA = tourMap.findById(idA);
  let entryB = tourMap.findById(idB);

  // If entryA has no locale, try to discover it by checking lateral/vertical neighbors.
  // We explicitly DO NOT check 'f' or 'b' neighbors, because doorways cross locale boundaries,
  // and inheriting a locale across a doorway causes the outside to merge with the inside.
  if (entryA && (entryA.localeId === null || entryA.localeId === -1)) {
    // Pass 1: check lateral/vertical neighbors
    for (const cmd of ['l', 'r', 'u', 'd']) {
      const neighborId = entryA.links[cmd] || (entryA.autoLinks && entryA.autoLinks[cmd]);
      if (neighborId) {
        const neighbor = tourMap.findById(neighborId);
        if (neighbor && neighbor.localeId !== null && neighbor.localeId !== -1) {
          entryA.localeId = neighbor.localeId;
          entryA.localeDescription = neighbor.localeDescription;
          entryA.markModified();
          break;
        }
      }
    }
    // We no longer scan backward in the file. Newly dropped nodes at the end of the file 
    // should remain orphans until explicitly grouped via "Create Locale from Views".
  }

  if (!entryB && idB) {
    entryB = new MapEntry();
    entryB.type = 'link';
    entryB.id = idB;
    assignCustomImageIfNeeded(entryB, imageNameB);
    
    // Inherit heading from entryA if missing
    if (entryA && entryA.heading && !entryB.heading) {
      entryB.heading = entryA.heading;
    }
    
    // Inherit locale and insert at the right position
    if (entryA && entryA.localeId !== null && entryA.localeId !== -1) {
      entryB.localeId = entryA.localeId;
      entryB.localeDescription = entryA.localeDescription;
      const idxA = tourMap.entries.indexOf(entryA);
      tourMap.addEntry(entryB, idxA + 1);
    } else {
      tourMap.addEntry(entryB);
    }
  } else if (entryA && entryB && entryA.heading && !entryB.heading) {
    entryB.heading = entryA.heading;
  }

  if (!entryA || !entryB) return;

  // Clear existing O/C links between these two to avoid conflicting states
  delete entryA.links['o'];
  delete entryA.links['c'];
  delete entryB.links['o'];
  delete entryB.links['c'];

  if (currentIsB) {
    entryA.links['c'] = idB;
    entryB.links['o'] = idA;
  } else {
    entryA.links['o'] = idB;
    entryB.links['c'] = idA;
  }

  // Copy shared directional links from entryA to entryB.
  // 'f' (forward) and 'z' (zoom) are open-door-only commands and must never
  // appear on the closed member — they are excluded from the copy loop.
  const DOOR_OPEN_ONLY = ['f', 'z'];
  for (const cmd of ['l', 'r', 'b', 'a', 'u', 'd']) {
    if (entryA.links[cmd] && !entryB.links[cmd]) {
      entryB.links[cmd] = entryA.links[cmd];
    }
  }

  // Ensure the closed entry NEVER has f or z, regardless of prior state.
  // Capture what gets stripped so we can warn the author.
  //
  // Polarity: when currentIsB=false → entryA.links['o']=idB → entryA IS closed.
  //           when currentIsB=true  → entryB.links['o']=idA → entryB IS closed.
  const closedEntry = currentIsB ? entryB : entryA;
  const strippedLinks = [];
  DOOR_OPEN_ONLY.forEach(cmd => {
    if (closedEntry.links[cmd]) {
      strippedLinks.push({ cmd, targetId: closedEntry.links[cmd] });
      delete closedEntry.links[cmd];
      closedEntry.markModified();
    }
  });

  // Inherit locale for existing entryB
  if (entryA.localeId !== null && entryA.localeId !== -1 && entryB.localeId !== entryA.localeId) {
    entryB.localeId = entryA.localeId;
    entryB.localeDescription = entryA.localeDescription;
    
    const idxA = tourMap.entries.indexOf(entryA);
    const idxB = tourMap.entries.indexOf(entryB);
    if (idxA >= 0 && idxB >= 0 && Math.abs(idxA - idxB) > 1) {
      let targetIdx = idxA + 1;
      if (idxB < targetIdx) targetIdx--;
      tourMap.moveEntry(idxB, targetIdx);
    }
  }

  entryA.markModified();
  entryB.markModified();
  markDirty();
  computeAutoLinks(tourMap);
  lineList.render();
  refreshCurrentSelection();
  rawLineEditor.update(selectedIndex);
  runValidation();

  // --- Issue 2: Notify author of auto-stripped links and stale references ---
  if (strippedLinks.length > 0) {
    const desc = strippedLinks
      .map(s => `'${COMMAND_LABELS[s.cmd] || s.cmd}' \u2192 #${s.targetId}`)
      .join(', ');
    showToast(`🚪 Door created: removed ${desc} from closed-door #${closedEntry.id} (not valid when closed). Open Checkout to review.`);
  }

  // Auto-pop the checkout report ONLY for hard errors on the closed door itself
  // (i.e. a forbidden f/z link wasn't stripped automatically).
  // We do NOT auto-pop for 'open_door_ref' — neighboring entries may legitimately
  // still point to the open door right after creation; the user can clean those up
  // at their own pace via the Issues button.
  const postDoorIssues = window.lastValidationResults || [];
  const hasHardDoorError = postDoorIssues.some(i =>
    i.actionData && i.actionData.type === 'door_open_only_conflict'
  );
  if (hasHardDoorError) {
    showCheckoutReport();
  }
}

function onEntryPropertyChanged() {
  const entry = selectedIndex >= 0 ? tourMap.entries[selectedIndex] : null;
  if (entry) entry.markModified();
  markDirty();
  computeAutoLinks(tourMap);
  refreshCurrentSelection();
  lineList.render();
  runValidation();
}

function onHeadingAssigned(photoId, heading, imageName) {
  if (activeVirtualLocale) {
    // --- VIRTUAL LOCALE MODE INTERCEPT ---
    // Save state for undo
    const stateMap = new Map();
    for (const [id, hdg] of activeVirtualLocale.inferredHeadings.entries()) {
      stateMap.set(id, hdg);
    }
    virtualLocaleUndoStack.push(stateMap);
    
    // Show undo button
    document.getElementById('btn-vl-undo')?.classList.remove('hidden');
    
    // 2. Run propagation across the virtual locale
    const { changed } = propagateHeadingChange(activeVirtualLocale, photoId, heading, tourMap);
    
    // 3. Update the preview
    const pseudoLocaleGroup = buildPseudoLocaleGroup(activeVirtualLocale);
    localeEditor.update(pseudoLocaleGroup, Number(photoId), true);
    
    // If all members now have headings, apply success class
    const isComplete = activeVirtualLocale.members.every(m => activeVirtualLocale.inferredHeadings.has(m.id));
    const btnFormalize = document.getElementById('btn-vl-formalize');
    if (btnFormalize) {
      if (isComplete) btnFormalize.classList.add('pulse-success');
      else btnFormalize.classList.remove('pulse-success');
    }
    return;
  }

  // --- NORMAL MODE ---
  let idx = tourMap.entries.findIndex(e => e.type === 'link' && e.id == photoId);
  const currentLocaleEntry = tourMap.entries[selectedIndex];
  let targetLocaleId = null;

  if (currentLocaleEntry) {
    targetLocaleId = currentLocaleEntry.type === 'locale' 
        ? currentLocaleEntry.localeId 
        : currentLocaleEntry.localeId;
  }

  // If we still don't have a locale, scan backward for the nearest locale header
  if (targetLocaleId === null || targetLocaleId === -1) {
    for (let i = selectedIndex - 1; i >= 0; i--) {
      const prev = tourMap.entries[i];
      if (prev.type === 'locale' && prev.localeId !== null) {
        targetLocaleId = prev.localeId;
        break;
      }
    }
  }

  if (idx < 0) {
    const newEntry = new MapEntry();
    newEntry.type = 'link';
    newEntry.id = photoId;
    assignCustomImageIfNeeded(newEntry, imageName);
    tourMap.addEntry(newEntry);
    idx = tourMap.entries.length - 1;
  }

  const entry = tourMap.entries[idx];
  entry.heading = heading;

  if (targetLocaleId !== null && targetLocaleId !== -1) {
    if (entry.localeId !== targetLocaleId) {
       entry.localeId = targetLocaleId;
       
       // Inherit the description mathematically from the overarching Group so UI displays it
       const targetGroup = tourMap.getLocaleGroups().find(g => g.localeId === targetLocaleId);
       if (targetGroup) {
         entry.localeDescription = targetGroup.description;
       }
       
       const oldIdx = idx;
       let targetInsert = selectedIndex + 1;
       
       if (oldIdx !== selectedIndex && oldIdx !== selectedIndex + 1) {
         if (oldIdx < targetInsert) targetInsert--;
         tourMap.moveEntry(oldIdx, targetInsert);
         if (oldIdx < selectedIndex) selectedIndex--;
         idx = targetInsert;
       }
    }
  }

  markDirty();
  if (entry) entry.markModified();
  computeAutoLinks(tourMap);
  
  if (idx >= 0) {
    selectedIndex = idx;
  }
  
  refreshCurrentSelection();
  lineList.render();
  runValidation();
}

const HEADING_DEGREES = {
  'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5, 'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
  'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5, 'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
};

function getHeadingDiff(h1, h2) {
  if (!h1 || !h2) return Infinity;
  let diff = Math.abs(HEADING_DEGREES[h1] - HEADING_DEGREES[h2]);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function findBestTargetImage(targetLocaleGroup, targetHeading) {
  let bestImg = null;
  let minDiff = Infinity;
  for (const entry of targetLocaleGroup.entries) {
    if (!entry.heading) continue;
    const diff = getHeadingDiff(targetHeading.toUpperCase(), entry.heading.toUpperCase());
    if (diff < minDiff) {
      minDiff = diff;
      bestImg = entry;
    } else if (diff === minDiff && bestImg) {
      // Tie-breaker: Prefer closed door member over open door member
      const bestIsOpenDoor = !!bestImg.links['c'];
      const entryIsClosedDoor = !!entry.links['o'];
      if (bestIsOpenDoor && entryIsClosedDoor) {
        bestImg = entry;
      }
    }
  }
  if (minDiff > 90) return null; // Too far off
  return bestImg;
}

function onConnectLocales(sourceId, sourceHeading, targetLocaleId) {
  const sourceEntry = tourMap.findById(sourceId);
  if (!sourceEntry) return;

  // 1. Clear links if input is cleared
  if (targetLocaleId === null) {
    let targetLocaleIdToClear = null;
    const oldTargetId = sourceEntry.links['f'];
    if (oldTargetId) {
      const oldTarget = tourMap.findById(oldTargetId);
      if (oldTarget && oldTarget.localeId !== sourceEntry.localeId) {
        targetLocaleIdToClear = oldTarget.localeId;
        delete sourceEntry.links['f'];
        delete oldTarget.links['b'];
        oldTarget.markModified();
      }
    }
    
    // Also clear reciprocal if it exists, using the known target locale to ensure safety
    // even if the reciprocal was a fuzzy match.
    if (targetLocaleIdToClear !== null) {
      const oppHeading = OPPOSITES[sourceHeading];
      if (oppHeading) {
        const sourceLocaleGroup = tourMap.getLocaleGroups().find(g => g.localeId === sourceEntry.localeId);
        if (sourceLocaleGroup) {
          const oppSource = findBestTargetImage(sourceLocaleGroup, oppHeading);
          if (oppSource) {
            const oldRecipTargetId = oppSource.links['f'];
            if (oldRecipTargetId) {
               const oldRecipTarget = tourMap.findById(oldRecipTargetId);
               if (oldRecipTarget && oldRecipTarget.localeId === targetLocaleIdToClear) {
                 delete oppSource.links['f'];
                 delete oldRecipTarget.links['b'];
                 oldRecipTarget.markModified();
                 oppSource.markModified();
               }
            }
          }
        }
      }
    }
    sourceEntry.markModified();
    markDirty();
    computeAutoLinks(tourMap);
    lineList.render();
    localeEditor.update(localeEditor.currentLocaleGroup, selectedIndex >= 0 ? tourMap.entries[selectedIndex].id : null);
    showToast(`Removed cross-locale connections for ${sourceHeading}`);
    return;
  }

  // 2. Connect to the target locale
  const targetLocale = tourMap.getLocaleGroups().find(g => g.localeId === targetLocaleId);
  if (!targetLocale) {
    showToast(`Locale #${targetLocaleId} not found.`);
    localeEditor.update(localeEditor.currentLocaleGroup, selectedIndex >= 0 ? tourMap.entries[selectedIndex].id : null);
    return;
  }

  const hasHeadings = targetLocale.entries.some(e => e.heading);
  if (!hasHeadings) {
    showToast(`Locale #${targetLocaleId} has no assigned headings yet. Cannot connect.`);
    localeEditor.update(localeEditor.currentLocaleGroup, selectedIndex >= 0 ? tourMap.entries[selectedIndex].id : null);
    return;
  }

  let msgs = [];

  // Primary Wiring: Source -> Target
  const primaryTarget = findBestTargetImage(targetLocale, sourceHeading);
  if (primaryTarget) {
    sourceEntry.links['f'] = primaryTarget.id;
    primaryTarget.links['b'] = sourceEntry.id;
    sourceEntry.markModified();
    primaryTarget.markModified();
    msgs.push(`Wired ${sourceHeading} -> Loc #${targetLocaleId}`);
  } else {
    msgs.push(`No match for ${sourceHeading} in Loc #${targetLocaleId}`);
  }

  // Reciprocal Wiring: Target's Opposite -> Source's Opposite
  const oppHeading = OPPOSITES[sourceHeading];
  if (oppHeading) {
    const oppTarget = findBestTargetImage(targetLocale, oppHeading);
    if (oppTarget) {
      const sourceLocaleGroup = tourMap.getLocaleGroups().find(g => g.localeId === sourceEntry.localeId);
      const oppSource = findBestTargetImage(sourceLocaleGroup, oppHeading);
      if (oppSource) {
        oppTarget.links['f'] = oppSource.id;
        oppSource.links['b'] = oppTarget.id;
        oppTarget.markModified();
        oppSource.markModified();
        msgs.push(`Reciprocal ${oppHeading} -> Loc #${sourceEntry.localeId}`);
      } else {
        msgs.push(`Skipped reciprocal (no ${oppHeading} in source loc)`);
      }
    } else {
      msgs.push(`Skipped reciprocal (no ${oppHeading} in Loc #${targetLocaleId})`);
    }
  }

  markDirty();
  computeAutoLinks(tourMap);
  lineList.render();
  localeEditor.update(localeEditor.currentLocaleGroup, selectedIndex >= 0 ? tourMap.entries[selectedIndex].id : null);
  showToast(msgs.join(' | '));
}

function onRawLineEdited() {
  markDirty();
  computeAutoLinks(tourMap);
  refreshCurrentSelection();
  lineList.render();
}

function onTextViewChanged() {
  markDirty();
  lineList.render();
  if (selectedIndex >= 0 && selectedIndex < tourMap.entries.length) {
    onLineSelected(selectedIndex);
  } else {
    onLineSelected(-1);
  }
  imageBrowser.render();
}

function onPrimaryDrop(photoId, imageName) {
  const currentEntry = selectedIndex >= 0 ? tourMap.entries[selectedIndex] : null;
  
  if (!currentEntry || currentEntry.type !== 'link') {
    // No link entry selected — create a new link entry directly
    const entry = new MapEntry();
    entry.type = 'link';
    entry.id = photoId || suggestNextId();
    assignCustomImageIfNeeded(entry, imageName);
    // Insert after current selection, or at end
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : tourMap.entries.length;
    tourMap.addEntry(entry, insertAt);
    markDirty();
    lineList.render();
    lineList.select(insertAt);
    imageBrowser.refreshUsedStatus();
    runValidation();
    return;
  }

  if (photoId !== null && photoId !== '') {
    currentEntry.id = photoId;
  }
  
  assignCustomImageIfNeeded(currentEntry, imageName);
  
  markDirty();
  refreshCurrentSelection();
  lineList.render();
  imageBrowser.refreshUsedStatus();
}

/**
 * Cycles through standard headings (N, NE, E, SE, S, SW, W, NW) for a given photo.
 */
function onCycleHeading(photoId, currentHeading) {
  const entry = tourMap.findById(photoId);
  if (!entry) return;

  const headings = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  let currentIdx = headings.indexOf(currentHeading?.toUpperCase());
  if (currentIdx < 0) currentIdx = -1;

  const nextIdx = (currentIdx + 1) % headings.length;
  entry.heading = headings[nextIdx];

  markDirty();
  refreshCurrentSelection();
  lineList.render();
  runValidation();
}

/**
 * Generates a helpful default ID for a new line.
 * If a prefix is set, it looks for the first image that isn't already used in the map.
 */
function suggestNextId() {
  const usedIds = new Set(tourMap.getLinkEntries().map(e => String(e.id)));
  
  // Try to find the first image ID that isn't used
  for (const name of imageBrowser.displayedNames) {
    const id = imageBrowser.extractIdFromFilename(name);
    if (id !== null && !usedIds.has(String(id))) {
      return id;
    }
  }

  // Fallback to simple increment
  const numIds = tourMap.getLinkEntries()
    .map(e => parseInt(e.id, 10))
    .filter(n => !isNaN(n));
  let nextNum = numIds.length > 0 ? Math.max(...numIds) + 1 : 1;
  
  let result = String(nextNum);
  if (tourMap.idPadding > 0) {
    result = result.padStart(tourMap.idPadding, '0');
  }
  return result;
}

// Update btnAddLine to use suggestNextId
btnAddLine.onclick = null; // Remove old listener if any (it was added via addEventListener though)
// Actually, let's just replace the listener logic in the next chunk.

// ---- Helpers ----

function loadMapFile(text) {
  let content = text;
  
  // Unconditionally try to strip the JS wrapper, if present
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length >= 3) {
    if (lines[0].includes('Tour links definition') && lines[1].includes('var embeddedData')) {
      content = lines.slice(2, -1).join('\n');
    }
  }
  const result = content.trim() === '' 
    ? { title: '', filenamePrefix: '', entries: [] }
    : parseMapFile(content);
  tourMap.replaceAll(result);
  fileHandle = fileHandle || null;

  computeAutoLinks(tourMap);

  lineList.render();
  imageBrowser.render();

  // Select first link entry, or first entry
  const firstLink = tourMap.entries.findIndex(e => e.type === 'link');
  if (firstLink >= 0) {
    lineList.select(firstLink);
  } else if (tourMap.entries.length > 0) {
    lineList.select(0);
  }

  // Enable buttons
  btnSave.disabled = false;
  btnSaveAs.disabled = false;
  btnAddLine.disabled = false;
  btnAddLocale.disabled = false;

  markClean();
  document.title = tourMap.title ? `TourMap Editor — ${tourMap.title}` : 'TourMap Editor';
  
  // Auto-pop the checkout report if there are issues that benefit from guided resolution
  const issues = window.lastValidationResults || [];
  const hasMismatch = issues.some(i => i.actionData && (
    i.actionData.type === 'sequence_mismatch' ||
    i.actionData.type === 'open_door_ref' ||
    i.actionData.type === 'door_open_only_conflict'
  ));
  if (hasMismatch) {
    showCheckoutReport();

  }
}

function refreshCurrentSelection() {
  if (activeVirtualLocale) {
    const pseudoLocaleGroup = buildPseudoLocaleGroup(activeVirtualLocale);
    // Determine active ID from selected index if it is a member
    let activeId = null;
    const selectedEntry = selectedIndex >= 0 ? tourMap.entries[selectedIndex] : null;
    if (selectedEntry && activeVirtualLocale.members.some(m => m.id === selectedEntry.id)) {
      activeId = selectedEntry.id;
    }
    localeEditor.update(pseudoLocaleGroup, activeId, true);
    return;
  }

  const index = selectedIndex;
  const entry = index >= 0 ? tourMap.entries[index] : null;

  if (currentMode === 'locale') {
    let localeGroup = null;
    let headerIdx = index;
    if (entry) {
      if (entry.type === 'locale') {
        localeGroup = tourMap.getLocaleGroups().find(g => g.localeId === entry.localeId) || null;
      } else if (entry.type === 'link') {
        localeGroup = tourMap.getLocaleForEntry(entry);
        if (localeGroup) {
          headerIdx = tourMap.entries.findIndex(e => e.type === 'locale' && e.localeId === localeGroup.localeId);
        }
      }
    }
    localeEditor.update(localeGroup, entry && entry.type === 'link' ? entry.id : null);
    propertiesPanel.update(index);
    rawLineEditor.update(headerIdx >= 0 ? headerIdx : index);
  } else {
    navGrid.update(entry);
    propertiesPanel.update(index);
    rawLineEditor.update(index);
  }
  
  imageBrowser.refreshUsedStatus();
  runValidation();
}

/**
 * Audit the map and update the "Issues" button badge.
 */
function runValidation() {
  if (!tourMap) return;
  const issues = MapValidator.validate(tourMap, imageBrowser.imageMap);
  const count = issues.length;
  
  if (count > 0) {
    issueCountEl.innerText = count;
    btnCheckout.classList.remove('hidden');
  } else {
    btnCheckout.classList.add('hidden');
  }
  
  window.lastValidationResults = issues; // Storage for the report modal
}

/**
 * Render and show the checkout modal.
 */
function showCheckoutReport() {
  const issues = window.lastValidationResults || [];
  checkoutResults.innerHTML = '';

  const checkoutTitle = document.getElementById('checkout-title');
  if (checkoutTitle) {
      if (issues.length > 0) checkoutTitle.innerHTML = 'Map Checkout Report <span style="font-size:12px; font-weight:normal; color:var(--text-tertiary); margin-left: 8px;">(Click a row to resolve the issue)</span>';
      else checkoutTitle.innerHTML = 'Map Checkout Report';
  }
  
  if (issues.length === 0) {
    checkoutResults.innerHTML = '<div class="empty-state">No issues found in the current map.</div>';
  } else {
    const list = document.createElement('div');
    list.className = 'validation-list';
    
    issues.forEach(issue => {
      const item = document.createElement('div');
      item.className = 'validation-item';

      // Build action buttons for actionable issue types
      let actionBtnHtml = '';
      if (issue.actionData) {
        if (issue.actionData.type === 'sequence_mismatch') {
          actionBtnHtml = ' <button class="info-icon btn-show-issue-details" style="cursor: pointer; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-size: 11px; color: var(--text-secondary);" title="Open Fix Problem dialog">🔧 Fix…</button>';
        } else if (issue.actionData.type === 'open_door_ref') {
          actionBtnHtml = `
            <button class="btn-fix-open-door-ref" data-entry-id="${issue.id}" data-cmd="${issue.actionData.cmd}" data-closed-id="${issue.actionData.closedId}"
              style="margin-left:8px; padding:2px 8px; border-radius:4px; font-size:11px; background:var(--success); color:#000; border:none; cursor:pointer;"
              title="Change link to point to the closed-door view">Use Closed Door</button>
            <button class="btn-suppress-open-door-ref" data-entry-id="${issue.id}"
              style="margin-left:4px; padding:2px 8px; border-radius:4px; font-size:11px; background:var(--bg-elevated); color:var(--text-secondary); border:1px solid var(--border); cursor:pointer;"
              title="Add * loose marker to suppress this warning">Suppress (*)</button>`;
        } else if (issue.actionData.type === 'door_open_only_conflict') {
          actionBtnHtml = `
            <button class="btn-fix-door-conflict" data-entry-id="${issue.id}" data-cmd="${issue.actionData.cmd}"
              style="margin-left:8px; padding:2px 8px; border-radius:4px; font-size:11px; background:var(--danger); color:#fff; border:none; cursor:pointer;"
              title="Remove the forbidden link from the closed-door view">Remove Link</button>`;
        } else if (issue.actionData.type === 'nav_ambiguity') {
          actionBtnHtml = `
            <button class="btn-suppress-nav-ambiguity" data-entry-id="${issue.id}"
              style="margin-left:8px; padding:2px 8px; border-radius:4px; font-size:11px; background:var(--bg-elevated); color:var(--text-secondary); border:1px solid var(--border); cursor:pointer;"
              title="Add * loose marker to suppress this warning — use only if the l/r links are intentional here">Suppress (*)</button>`;
        } else if (issue.actionData.type === 'cross_locale_lr' || issue.actionData.type === 'split_door') {
          actionBtnHtml = `
            <button class="btn-suppress-locale-anomaly" data-entry-id="${issue.id}"
              style="margin-left:8px; padding:2px 8px; border-radius:4px; font-size:11px; background:var(--bg-elevated); color:var(--text-secondary); border:1px solid var(--border); cursor:pointer;"
              title="Add * loose marker to suppress this warning">Suppress (*)</button>`;
        }
      }

      item.innerHTML = `
        <span class="issue-type-badge issue-type-${issue.type}">${issue.type}</span>
        <div class="issue-content">
          <div class="issue-title">${issue.category}</div>
          <div class="issue-msg">${issue.message}${actionBtnHtml}</div>
          <div class="issue-meta" style="font-size: 14px; font-weight: 600; margin-top: 6px; color: var(--text-primary);">Line: ${issue.lineIndex + 3}${issue.id ? ` <span style="font-weight:normal; color: var(--text-secondary);">| Photo ID: #${issue.id}</span>` : ''}</div>
        </div>
      `;

      // Handle the main click event
      item.onclick = (e) => {
        // Prevent firing if the user clicked one of our action buttons
        if (e.target.tagName === 'BUTTON') return;
        
        if (issue.actionData && issue.actionData.type === 'sequence_mismatch') {
           showIssueDetails(issue);
           return;
        }
        
        returnContext = { type: 'checkout' };
        const plainMsg = issue.message.replace(/<[^>]*>?/gm, ''); // Strip HTML tags
        showReturnBanner('Return to Checkout Report', () => {
           showCheckoutReport();
           document.getElementById('checkout-modal').classList.remove('hidden');
           hideReturnBanner();
        }, plainMsg);
        
        onLineSelected(issue.lineIndex);
        lineList.scrollToIndex(issue.lineIndex);
        checkoutModal.classList.add('hidden');
        // Ensure the raw line is visible to show the offending tokens
        if (rawLineEditor.el) {
           rawLineEditor.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
           rawLineEditor.el.focus();
        }
      };
      
      // Wire up action buttons after DOM insertion
      setTimeout(() => {
        const infoIcon = item.querySelector('.btn-show-issue-details');
        if (infoIcon) {
          infoIcon.onclick = (e) => { e.stopPropagation(); showIssueDetails(issue); };
        }

        // "Suppress (*)" button for Navigation Ambiguity
        const suppressNavBtn = item.querySelector('.btn-suppress-nav-ambiguity');
        if (suppressNavBtn) {
          suppressNavBtn.onclick = (e) => {
            e.stopPropagation();
            const entryId = suppressNavBtn.dataset.entryId;
            const entry = tourMap.findById(entryId);
            if (entry && !entry.unsupportedTokens.includes('*loose')) {
              entry.unsupportedTokens.push('*loose');
              entry.markModified();
              markDirty();
              runValidation();
              showCheckoutReport();
              refreshCurrentSelection();
            }
          };
        }

        // "Use Closed Door" button: repoint the link to the closed-door ID
        const fixOpenDoorBtn = item.querySelector('.btn-fix-open-door-ref');
        if (fixOpenDoorBtn) {
          fixOpenDoorBtn.onclick = (e) => {
            e.stopPropagation();
            const entryId = fixOpenDoorBtn.dataset.entryId;
            const cmd = fixOpenDoorBtn.dataset.cmd;
            const closedId = fixOpenDoorBtn.dataset.closedId;
            const entry = tourMap.findById(entryId);
            if (entry) {
              entry.links[cmd] = closedId;
              entry.markModified();
              markDirty();
              runValidation();
              showCheckoutReport();
              refreshCurrentSelection();
            }
          };
        }

        // "Suppress (*)" button: add *loose to suppress open-door-ref warning
        const suppressBtn = item.querySelector('.btn-suppress-open-door-ref');
        if (suppressBtn) {
          suppressBtn.onclick = (e) => {
            e.stopPropagation();
            const entryId = suppressBtn.dataset.entryId;
            const entry = tourMap.findById(entryId);
            if (entry && !entry.unsupportedTokens.includes('*loose')) {
              entry.unsupportedTokens.push('*loose');
              entry.markModified();
              markDirty();
              runValidation();
              showCheckoutReport();
              refreshCurrentSelection();
            }
          };
        }

        // "Remove Link" button: strip the forbidden f/z from the closed door
        const fixDoorConflictBtn = item.querySelector('.btn-fix-door-conflict');
        if (fixDoorConflictBtn) {
          fixDoorConflictBtn.onclick = (e) => {
            e.stopPropagation();
            const entryId = fixDoorConflictBtn.dataset.entryId;
            const cmd = fixDoorConflictBtn.dataset.cmd;
            const entry = tourMap.findById(entryId);
            if (entry && entry.links[cmd]) {
              delete entry.links[cmd];
              entry.markModified();
              markDirty();
              runValidation();
              showCheckoutReport();
              refreshCurrentSelection();
            }
          };
        }

        // "Suppress (*)" button for Locale Anomalies
        const suppressLocaleAnomalyBtn = item.querySelector('.btn-suppress-locale-anomaly');
        if (suppressLocaleAnomalyBtn) {
          suppressLocaleAnomalyBtn.onclick = (e) => {
            e.stopPropagation();
            const entryId = suppressLocaleAnomalyBtn.dataset.entryId;
            const entry = tourMap.findById(entryId);
            if (entry && !entry.unsupportedTokens.includes('*loose')) {
              entry.unsupportedTokens.push('*loose');
              entry.markModified();
              markDirty();
              runValidation();
              showCheckoutReport();
              refreshCurrentSelection();
            }
          };
        }
      }, 0);
      
      list.appendChild(item);
    });
    checkoutResults.appendChild(list);
  }
  
  checkoutModal.classList.remove('hidden');
}

/**
 * Show detailed mismatch matrix for sequence syncing issues
 */
function showIssueDetails(issue, userResolvedConflicts = {}) {
  const detailsModal = document.getElementById('issue-details-modal');
  const detailsResults = document.getElementById('issue-details-results');
  if (!detailsModal || !detailsResults) return;

  if (!issue.actionData || issue.actionData.type !== 'sequence_mismatch') return;
  const subtype = issue.actionData.subtype;
  const allIds = [issue.id, ...issue.actionData.groupId].sort();
  
  let label = "Sequence";
  if (subtype === 'np') label = "Next/Previous";
  if (subtype === 'ej') label = "Earlier/Later";
  if (subtype === 'qw') label = "Shift (Left/Right)";

  let directionalCmds = ['l', 'r', 'f', 'b', 'u', 'd', 'a'];
  if (subtype === 'qw') {
     directionalCmds = ['b'];
  }
  
  // Standard display order for ALL links
  const allCmds = ['l', 'r', 'f', 'b', 'u', 'd', 'a', 'n', 'p', 'q', 'w', 'e', 'j', 'o', 'c', 'z'];

  const linkVariants = {};
  directionalCmds.forEach(cmd => linkVariants[cmd] = new Set());

  // Track all variants for each synchronized command to detect conflicts
  allIds.forEach(id => {
    const e = tourMap.findById(id);
    if (e) {
      directionalCmds.forEach(cmd => {
        if (e.links[cmd]) {
          // Skip self-links for 'b' when tracking variants, since they aren't part of the shared sequence data
          if (cmd === 'b' && e.links[cmd] === e.id) return;
          linkVariants[cmd].add(e.links[cmd]);
        }
      });
    }
  });

  // Determine if there are actual conflicts and incorporate user resolved state
  let hasConflicts = false;
  const unifiedLinks = {}; 
  directionalCmds.forEach(cmd => {
    if (userResolvedConflicts[cmd] !== undefined) {
       unifiedLinks[cmd] = userResolvedConflicts[cmd];
    } else if (linkVariants[cmd].size > 1) {
      hasConflicts = true;
    } else if (linkVariants[cmd].size === 1) {
      unifiedLinks[cmd] = Array.from(linkVariants[cmd])[0];
    }
  });

  let html = '';
  if (hasConflicts) {
     html += `<p style="margin-bottom: 12px; color: var(--warning);">These photos are linked as a <strong>${label}</strong> sequence, so their directional links must match across all members. Multiple views disagree on a destination — <strong>click a red conflict badge below</strong> to choose which value the whole sequence should use.</p>`;
  } else {
     html += `<p style="margin-bottom: 12px; color: var(--text-secondary);">These photos are linked as a <strong>${label}</strong> sequence. Directional links (l/r/u/d, etc.) are expected to be identical across every member. <strong>Yellow (+) entries</strong> show links that are present on some members but missing on others — clicking <em>Fix Omissions</em> will add them. Links shown in <span style="color:var(--text-tertiary)">gray</span> are outside this sequence type and will not be changed.</p>`;
  }

  html += `<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">`;
  html += `<thead><tr style="background: var(--bg-hover); border-bottom: 1px solid var(--border);"><th style="padding: 8px; text-align: left;">Photo ID</th><th style="padding: 8px; text-align: left;">Links</th></tr></thead>`;
  html += `<tbody>`;

  allIds.forEach(id => {
    const e = tourMap.findById(id);
    if (!e) return;
    
    const entryIndex = tourMap.entries.indexOf(e);
    const lineLabel = entryIndex >= 0 ? `Line ${entryIndex + 3}` : 'Unknown';

    let linksDisplay = [];
    
    allCmds.forEach(cmd => {
      const myLink = e.links[cmd];
      
      // If it's part of the sync check for this sequence:
      if (directionalCmds.includes(cmd)) {
         const isConflict = linkVariants[cmd].size > 1 && userResolvedConflicts[cmd] === undefined;

         if (isConflict) {
           if (myLink) {
              if (cmd === 'b' && myLink === e.id) return; // skip b self-links
              // Clickable conflict badge
              linksDisplay.push(`<button class="btn-conflict-resolve" data-cmd="${cmd}" data-target="${myLink}" style="background: var(--danger); color: white; border: none; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-family: var(--font-mono); font-size: 11px; margin-right: 8px;" title="Click to enforce ${cmd}=${myLink} across sequence">[ ${cmd}=${myLink} ]</button>`);
           }
         } else {
           const expectedLink = unifiedLinks[cmd];
           if (expectedLink) {
             if (cmd === 'b' && expectedLink === e.id) {
               // expected is a self link, do nothing for expectation rendering
             } else if (myLink === expectedLink) {
                linksDisplay.push(`<span style="color: var(--text-primary); margin-right: 8px; font-weight: bold;">${cmd}=${myLink}</span>`);
             } else if (!myLink) {
                linksDisplay.push(`<span style="color: var(--warning); margin-right: 8px; font-weight: bold;" title="Proposed missing link">+${cmd}=${expectedLink}</span>`);
             } else if (myLink !== expectedLink) {
                linksDisplay.push(`<span style="text-decoration: line-through; color: var(--text-tertiary); margin-right: 4px;">${cmd}=${myLink}</span><span style="color: var(--warning); margin-right: 8px; font-weight: bold;" title="Proposed overwrite change">&rarr; ${expectedLink}</span>`);
             }
           } else if (myLink) {
              linksDisplay.push(`<span style="color: var(--text-primary); margin-right: 8px; font-weight: bold;">${cmd}=${myLink}</span>`);
           }
         }
      } else {
         // It's out of scope for this sequence type. Render it in gray if it exists.
         if (myLink) {
            linksDisplay.push(`<span style="color: var(--text-tertiary); margin-right: 8px;">${cmd}=${myLink}</span>`);
         }
      }
    });

    if (linksDisplay.length === 0) linksDisplay.push(`<span style="color: var(--text-tertiary); font-style: italic;">No links defined</span>`);

    html += `<tr style="border-bottom: 1px dashed var(--border);">`;
    html += `<td style="padding: 8px; font-weight: bold;">#${e.id} <span style="font-weight:normal; font-size:10px; color:var(--text-tertiary);">(${lineLabel})</span></td>`;
    html += `<td style="padding: 8px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">${linksDisplay.join('')}</td>`;
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  
  detailsResults.innerHTML = html;

  // Bind Resolution drafting
  const resolveBtns = detailsResults.querySelectorAll('.btn-conflict-resolve');
  resolveBtns.forEach(btn => {
     btn.addEventListener('click', () => {
        const targetCmd = btn.dataset.cmd;
        const targetId = btn.dataset.target;
        const newConflicts = { ...userResolvedConflicts, [targetCmd]: targetId };
        showIssueDetails(issue, newConflicts);
     });
  });
  
  // Bind Footer Buttons
  const btnFix = document.getElementById('btn-fix-issue-details');
  const btnLoose = document.getElementById('btn-loose-issue-details');
  
  if (btnFix) {
      btnFix.onclick = () => {
         // Check if any conflicts are still unresolved
         const unres = directionalCmds.find(cmd => linkVariants[cmd] && linkVariants[cmd].size > 1 && userResolvedConflicts[cmd] === undefined);
         if (unres) {
            alert("Please resolve the red conflicting links before applying fixes.");
            return;
         }

         allIds.forEach(id => {
            const e = tourMap.findById(id);
            if (e) {
               directionalCmds.forEach(cmd => {
                  if (unifiedLinks[cmd]) {
                     if (cmd === 'b' && unifiedLinks[cmd] === e.id) return;
                     e.links[cmd] = unifiedLinks[cmd];
                  }
               });
               e.markModified();
            }
         });
         runValidation();
         showCheckoutReport();
         refreshCurrentSelection();
         detailsModal.classList.add('hidden');
      };
  }
  
  if (btnLoose) {
      btnLoose.onclick = () => {
         allIds.forEach(id => {
            const e = tourMap.findById(id);
            if (e && !e.unsupportedTokens.includes('*loose')) {
               e.unsupportedTokens.push('*loose');
               e.markModified();
            }
         });
         runValidation();
         showCheckoutReport();
         refreshCurrentSelection();
         detailsModal.classList.add('hidden');
      };
  }

  detailsModal.classList.remove('hidden');
}

function markDirty() {
  isDirty = true;
  virtualLocalesDirty = true; // Virtual locale cache needs recomputation
  if (showVirtualLocales) {
    // Debounce or call updateVirtualLocaleUI
    setTimeout(() => updateVirtualLocaleUI(), 0);
  }
  const title = tourMap.title ? `TourMap Editor — ${tourMap.title}` : 'TourMap Editor';
  document.title = '● ' + title;
}

function markClean() {
  isDirty = false;
  const title = tourMap.title ? `TourMap Editor — ${tourMap.title}` : 'TourMap Editor';
  document.title = title;
}

function downloadFile(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  markClean();
}

function initResizers() {
  const setup = (handleId, sidebarId, side) => {
    const resizer = document.getElementById(handleId);
    const sidebar = document.getElementById(sidebarId);
    if (!resizer || !sidebar) return;

    let isDragging = false;

    resizer.addEventListener('mousedown', (e) => {
      isDragging = true;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const mouseX = e.clientX;
      
      // Use requestAnimationFrame for smooth, performant resizing
      requestAnimationFrame(() => {
        if (!isDragging) return;

        let newWidth;
        if (side === 'left') {
          newWidth = mouseX - sidebar.getBoundingClientRect().left;
        } else {
          newWidth = window.innerWidth - mouseX;
        }

        if (newWidth > 160 && newWidth < (window.innerWidth * 0.45)) {
          // Update the DOM element directly for immediate, non-thrashing performance
          sidebar.style.width = `${newWidth}px`;
        }
      });
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
        
        // Only update the global CSS variables on mouseup to persist the state 
        // without causing heavy layout re-calculations on every mouse frame.
        const newWidth = sidebar.offsetWidth;
        const varName = side === 'left' ? '--sidebar-left-w' : '--sidebar-right-w';
        document.documentElement.style.setProperty(varName, `${newWidth}px`);
      }
    });
  };

  setup('sidebar-resizer', 'line-list-panel', 'left');
  setup('right-sidebar-resizer', 'image-browser-panel', 'right');
}

// ---- Unsaved changes guard ----
window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
  // Ctrl+S to save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (!btnSave.disabled) btnSave.click();
  }
  // Ctrl+O to open
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    btnOpenMap.click();
  }
});

// Initialize resizers
initResizers();

// ---- Virtual Locale Formalization Workflow ----

function buildPseudoLocaleGroup(vl) {
  // Create a fake locale group for the editor to render
  return {
    localeId: vl.id, // Negative ID marks it as virtual
    description: '',
    entries: vl.members.map(m => {
      // Create a cloned entry so we don't accidentally mutate the real one
      const clone = new MapEntry();
      Object.assign(clone, m);
      // Give it the inferred heading from the virtual locale
      clone.inferredHeading = vl.inferredHeadings.get(m.id) || null;
      return clone;
    })
  };
}

function previewVirtualLocale(vl) {
  // If we're already formalizing one, discard it first to prevent tangling state
  if (activeVirtualLocale && activeVirtualLocale.id !== vl.id) {
    discardVirtualLocale();
  }

  activeVirtualLocale = vl;
  virtualLocaleUndoStack = [];
  
  // Update UI mode
  setMode('locale');
  
  // Set up editor callbacks
  localeEditor.onVirtualFormalize = (description) => commitVirtualLocale(description);
  localeEditor.onVirtualDiscard = () => discardVirtualLocale();
  localeEditor.onVirtualUndo = () => {
    if (virtualLocaleUndoStack.length > 0) {
      activeVirtualLocale.inferredHeadings = virtualLocaleUndoStack.pop();
      if (virtualLocaleUndoStack.length === 0) {
        document.getElementById('btn-vl-undo')?.classList.add('hidden');
      }
      const pseudoLocaleGroup = buildPseudoLocaleGroup(activeVirtualLocale);
      localeEditor.update(pseudoLocaleGroup, null, true);
      
      const isComplete = activeVirtualLocale.members.every(m => activeVirtualLocale.inferredHeadings.has(m.id));
      const btnFormalize = document.getElementById('btn-vl-formalize');
      if (btnFormalize) {
        if (isComplete) btnFormalize.classList.add('pulse-success');
        else btnFormalize.classList.remove('pulse-success');
      }
    }
  };

  // Check if we need to seed
  if (vl.inferredHeadings.size === 0) {
    // Show banner text prompting for initial heading
    document.getElementById('vl-description-input').placeholder = "Drag any image to a heading to begin...";
  } else {
    document.getElementById('vl-description-input').placeholder = "Enter locale description...";
  }
  
  document.getElementById('btn-vl-undo')?.classList.add('hidden');
  document.getElementById('btn-vl-formalize')?.classList.remove('pulse-success');
  document.getElementById('vl-description-input').value = '';

  const pseudoLocaleGroup = buildPseudoLocaleGroup(activeVirtualLocale);
  localeEditor.update(pseudoLocaleGroup, null, true);
}

function discardVirtualLocale() {
  activeVirtualLocale = null;
  virtualLocaleUndoStack = [];
  // Return to view mode
  setMode('view');
}

function finalizeVirtualLocale(vl, description) {
  // 1. Validate complete heading coverage
  const unassigned = vl.members.filter(m => !vl.inferredHeadings.has(m.id));
  if (unassigned.length > 0) return null;

  // 2. Allocate new ID
  const newLocaleId = tourMap.getNextLocaleId();
  
  // 3. Create Locale Entry
  const localeEntry = new MapEntry();
  localeEntry.type = 'locale';
  localeEntry.localeId = newLocaleId;
  localeEntry.localeText = description || `Locale ${newLocaleId}`;
  
  // 4. Update member entries
  vl.members.forEach(m => {
    m.localeId = newLocaleId;
    m.heading = vl.inferredHeadings.get(m.id);
    m.localeDescription = localeEntry.localeText;
    
    // Erase cyclic links that are now handled by the locale container
    const linksToErase = ['l', 'r', 'a'];
    linksToErase.forEach(cmd => {
      if (m.links[cmd]) {
        const targetId = m.links[cmd];
        if (vl.members.some(member => member.id === targetId)) {
           delete m.links[cmd];
        }
      }
    });
    
    m.raw = null; // Forces regeneration of the line during serialization
  });
  
  // 5. Append locale entry to map
  const firstMemberIndex = tourMap.entries.findIndex(e => e.id === vl.members[0].id);
  if (firstMemberIndex !== -1) {
    tourMap.entries.splice(firstMemberIndex, 0, localeEntry);
  } else {
    tourMap.entries.push(localeEntry);
  }
  
  return localeEntry;
}

function commitVirtualLocale(description) {
  if (!activeVirtualLocale) return;
  const vl = activeVirtualLocale;
  
  const localeEntry = finalizeVirtualLocale(vl, description);
  if (!localeEntry) {
    showToast(`Cannot formalize: some views still need headings.`);
    return;
  }
  
  // 6. Clean up state
  activeVirtualLocale = null;
  virtualLocaleUndoStack = [];
  
  // 7. Refresh UI
  markDirty();
  computeAutoLinks(tourMap);
  lineList.render();
  
  // Select the newly created locale
  const newIdx = tourMap.entries.findIndex(e => e === localeEntry);
  if (newIdx !== -1) {
    lineList.select(newIdx);
    lineList.scrollToIndex(newIdx);
  }
  
  showToast(`Formalized Locale #${localeEntry.localeId}`);
}

function formalizeAllVirtualLocales() {
  const vls = getVirtualLocales();
  let formalizedCount = 0;

  vls.forEach(vl => {
    // Check if fully inferred
    const unassigned = vl.members.filter(m => !vl.inferredHeadings.has(m.id));
    if (unassigned.length === 0) {
      finalizeVirtualLocale(vl, `Locale ${tourMap.getNextLocaleId()}`);
      formalizedCount++;
    }
  });

  if (formalizedCount > 0) {
    if (activeVirtualLocale) {
      activeVirtualLocale = null;
      virtualLocaleUndoStack = [];
      setMode('view');
    }
    markDirty();
    computeAutoLinks(tourMap);
    lineList.render();
    showToast(`Successfully formalized ${formalizedCount} virtual locale(s).`);
  } else {
    showToast(`No complete virtual locales found to formalize.`);
  }
}
