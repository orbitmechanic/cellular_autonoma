// saved organisms, per wallet+chain, in localStorage
const KEY = "cellular_autonoma.orgs.v1";
export function loadOrgs() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveOrg(org) {
  const all = loadOrgs().filter((o) => !(o.colony === org.colony && o.chainId === org.chainId));
  all.unshift({ ...org, savedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)));
}
export function forgetOrg(colony, chainId) {
  localStorage.setItem(KEY, JSON.stringify(loadOrgs().filter((o) => !(o.colony === colony && o.chainId === chainId))));
}
