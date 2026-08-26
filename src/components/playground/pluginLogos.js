// pluginLogos.js — resolve a plugin call to its logo URL, the JSX port of the
// source app's useCachedPluginLogo hook + DEFAULT_PLUGIN_LOGO_URL constant.
//
// Plugin calls reconstructed by parsePluginCalls carry { pluginId, name, identifier }
// (see parseAgentic.js); executed/retrieved agents may also carry an agentId. We key
// the logo lookup on all of those so any of the forms the wire uses will match.
//
// The URL table below is seeded from ADOPTED_PLUGIN_IDS (ondemandDirect.js). An empty
// `logoUrl` means "no logo", which makes PluginAvatar fall back to the lettered chip.

/**
 * Logo table keyed by pluginId (plugin-XXXX). `name` is informational; `logoUrl`
 * is what renders. Add/replace entries from the plugin-logo logs.
 * @type {Record<string, { name: string, logoUrl: string }>}
 */
export const PLUGIN_LOGOS = {
  'plugin-1713924030': { name: 'Internet Search', logoUrl: '/plugins/internet.png' },
  'plugin-1722260873': { name: 'Perplexity', logoUrl: '/plugins/perplexity.webp' },
  'plugin-1741871229': { name: 'GPT Search', logoUrl: '/plugins/gpt-search.png' },
  'plugin-1740745780': { name: 'AI Search (Tavily)', logoUrl: '' },
  'plugin-1737365406': { name: 'Web Content Extractor', logoUrl: '' },
  'plugin-1743257072': { name: 'File Directory Search', logoUrl: '' },
  'plugin-1776826082': { name: 'GPT Image 2', logoUrl: '/plugins/gpt-image-gen-2.webp' },
  'plugin-1775547203': { name: 'OnDemand Agent (files/XLSX)', logoUrl: '/plugins/ondemand-agent.webp' },
};

/** agent-XXXX -> plugin-XXXX so an agentId can hit the pluginId-keyed table. */
const toPluginId = (id) =>
  typeof id === 'string' && id.startsWith('agent-')
    ? id.replace(/^agent-/, 'plugin-')
    : id;

// name (lowercased) -> logoUrl, derived once from PLUGIN_LOGOS for name-only matches.
const LOGOS_BY_NAME = Object.values(PLUGIN_LOGOS).reduce((acc, { name, logoUrl }) => {
  if (name && logoUrl) acc[name.trim().toLowerCase()] = logoUrl;
  return acc;
}, /** @type {Record<string, string>} */ ({}));

/**
 * Resolve a plugin call to its logo URL, or '' when unknown.
 * Tries pluginId, then agentId (normalised), then identifier, then name.
 * @param {{ pluginId?: string, agentId?: string, identifier?: string, name?: string }} plugin
 * @returns {string}
 */
export function resolvePluginLogoUrl(plugin) {
  if (!plugin || typeof plugin !== 'object') return '';
  const keys = [plugin.pluginId, toPluginId(plugin.agentId), toPluginId(plugin.identifier)];
  for (const key of keys) {
    if (key && PLUGIN_LOGOS[key]?.logoUrl) return PLUGIN_LOGOS[key].logoUrl;
  }
  const byName = plugin.name && LOGOS_BY_NAME[plugin.name.trim().toLowerCase()];
  return byName || '';
}
