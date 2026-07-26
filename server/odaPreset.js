// odaPreset.js — fetch and resolve the ODA playground preset (+ skill names).
import { listPresets, listSkills } from './ondemand.js';

export const ODA_PRESET_ID = process.env.ODA_PRESET_ID || '6a64473931a6f986a9a147c1';

const CACHE_MS = 60_000;
let cache = { at: 0, data: null };

const pickPresetList = (payload) => {
  const root = payload?.data ?? payload;
  if (Array.isArray(root)) return root;
  if (Array.isArray(root?.items)) return root.items;
  if (Array.isArray(root?.presets)) return root.presets;
  if (Array.isArray(root?.data)) return root.data;
  return [];
};

const pickSkillList = (payload) => {
  const root = payload?.data ?? payload;
  if (Array.isArray(root)) return root;
  if (Array.isArray(root?.skills)) return root.skills;
  if (Array.isArray(root?.items)) return root.items;
  if (Array.isArray(root?.data)) return root.data;
  return [];
};

/** Map a raw preset record into the query-ready shape. */
export function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id,
    name: raw.name || 'ODA',
    endpoint: raw.endpoint,
    chatPlugins: Array.isArray(raw.chatPlugins) ? raw.chatPlugins.filter(Boolean) : [],
    filePlugins: Array.isArray(raw.filePlugins) ? raw.filePlugins.filter(Boolean) : [],
    skillIds: Array.isArray(raw.skillIds) ? raw.skillIds.filter(Boolean) : [],
    responseMode: raw.responseMode || 'stream',
    temperature: typeof raw.temperature === 'number' ? raw.temperature : 0.7,
    topP: typeof raw.topP === 'number' ? raw.topP : 1,
    presencePenalty: typeof raw.presencePenalty === 'number' ? raw.presencePenalty : 0,
    stopSequences: Array.isArray(raw.stopSequences) ? raw.stopSequences : [],
    fulfillmentPrompt: raw.fulfillmentPrompt || '',
    reasoningEffort: raw.reasoningEffort || 'medium',
    reasoningMode: raw.reasoningMode || null,
    debugMode: Boolean(raw.debugMode),
    maxTokens: raw.maxTokens ?? null,
    status: raw.status || null,
    category: raw.category || '',
    ragVersion: raw.ragVersion || null,
    updatedAt: raw.updatedAt || null,
  };
}

/** Build the OnDemand query overrides from a normalized preset. */
export function presetQueryOptions(preset) {
  if (!preset) return {};
  return {
    endpointId: preset.endpoint,
    reasoningEffort: preset.reasoningEffort,
    skillIds: preset.skillIds,
    pluginIds: preset.chatPlugins,
    systemPrompt: preset.fulfillmentPrompt,
    modelConfigs: {
      temperature: preset.temperature,
      topP: preset.topP,
      presencePenalty: preset.presencePenalty,
      stopSequences: preset.stopSequences,
      ...(preset.fulfillmentPrompt ? { fulfillmentPrompt: preset.fulfillmentPrompt } : {}),
    },
  };
}

/**
 * Fetch the configured ODA preset and resolve skill names for UI display.
 * @returns {Promise<{ preset: object|null, skills: { id: string, name: string }[] }>}
 */
export async function getOdaPreset({ refresh = false } = {}) {
  if (!refresh && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  const listPayload = await listPresets({ page: 1, limit: 100, sortBy: 'updatedAt' });
  const presets = pickPresetList(listPayload);
  const raw = presets.find((p) => p?.id === ODA_PRESET_ID)
    || presets.find((p) => p?.name === 'ODA');
  const preset = normalizePreset(raw);

  let skills = [];
  if (preset?.skillIds?.length) {
    try {
      const skillPayload = await listSkills(preset.skillIds);
      const rows = pickSkillList(skillPayload);
      const byId = new Map(rows.map((s) => [s.id, s.name || s.title || s.slug || s.id]));
      skills = preset.skillIds.map((id) => ({ id, name: byId.get(id) || id }));
    } catch (err) {
      console.error('[oda-preset] skill list failed:', err.message);
      skills = preset.skillIds.map((id) => ({ id, name: id }));
    }
  }

  const data = { preset, skills };
  cache = { at: Date.now(), data };
  return data;
}
