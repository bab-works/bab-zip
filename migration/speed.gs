// One legacy guest read, restricted to the benchmark runner. Return only a success flag.
function benchmarkRead_(e) {
  const b = JSON.parse(e.postData.contents);
  if (Date.now() > __EXPIRY__ || !authOk_(b.ownerToken) ||
      Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(b.proof || ''))) !== '__PROOF_HASH__' ||
      !['me','lists','habits'].includes(b.what) || !b.guest || authOk_(b.guest)) return out_({ok:false});
  const result = JSON.parse(snapshotUnusedGet_({parameter:{token:b.guest,what:b.what}}).getContent());
  return out_({ok:result.ok === true});
}
