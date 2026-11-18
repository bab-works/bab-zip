// Added only to a short-lived version. Code.gs and the app's live deployment stay on their normal versions.
function exportFriendsOnce_(e) {
  const b = JSON.parse(e.postData.contents);
  if (Date.now() > __EXPIRY__ || !authOk_(b.token) || Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(b.proof || ''))) !== '__PROOF_HASH__')
    return out_({ok:false});
  return withLock_(() => {
    tz_ = exportSheet_().getSpreadsheetTimeZone();
    const read = tab => body_(exportSheet_().getSheetByName(tab)).filter(row => row.some(x => x !== ''));
    const accounts = read(FRIEND_TAB_), publications = read(PUB_TAB_);
    const friends = accounts.map(r => String(r[0]).trim()).filter(Boolean);
    const visible = new Set(publications.filter(r => r[0] === 'owner').map(r => JSON.stringify([r[1], String(r[2])])));
    const projection = [];
    // listRead_ normally assigns missing ids. This export is read-only and checks ids only on shared rows.
    for (const list of Object.keys(LISTS)) {
      if (!exportSheet_().getSheetByName(LISTS[list].tab)) continue;
      for (const item of exportListRead_(list)) {
        const tagged = friends.some(name => tagged_(item,name));
        if (!tagged && !visible.has(JSON.stringify([list,item.id]))) continue;
        if (!item.id) throw new Error('shared record missing id');
        if (!tagged) { delete item.with; delete item.cost; delete item.quotes; }
        projection.push([list,item.id,item]);
      }
    }
    return out_({ok:true,owner:ownerName_(),accounts,publications,projection,
      records:read(FREC_TAB_),habits:read(FHAB_TAB_),relations:read(REL_TAB_),
      houses:read(HOUSE_TAB_),reports:read('제보')});
  });
}


// Read the same named columns and values as listRead_, without assigning ids or creating tabs.
function exportListRead_(list) {
  const cfg = LISTS[list], sh = exportSheet_().getSheetByName(cfg.tab);
  const map = listMap_(sh, cfg), last = listLast_(sh, cfg, map);
  if (last <= cfg.head) return [];
  const n = last - cfg.head, values = sh.getRange(cfg.head+1,1,n,sh.getLastColumn()).getValues();
  const img = map.image && map.image.col, formulas = img && sh.getRange(cfg.head+1,img,n,1).getFormulas();
  return values.map((row,i) => {
    const result = {id: String(row[map.__id-1] || '')};
    for (const key of Object.keys(cfg.f)) {
      if (!map[key].col || key === 'image') continue;
      const value = row[map[key].col-1], type = map[key].type;
      if (type === 'bool') result[key] = value === true;
      else if (type === 'num') result[key] = value === '' ? '' : num_(value);
      else if (type === 'date') result[key] = fmt_(value,'yyyy-MM-dd');
      else result[key] = String(value == null ? '' : value);
      if (key === 'stars') result[key] = fromStars_(result[key]);
    }
    const raw = img ? String(row[img-1]) : '';
    result.image = imgOf_(formulas && formulas[i][0]) || (/^https?:\/\//.test(raw) ? raw : '');
    return result;
  }).filter(item => item[cfg.key] !== '');
}
