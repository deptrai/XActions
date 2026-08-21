// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Plugin Manager
 * Manages plugin lifecycle: install, uninstall, enable, disable, and hook execution.
 * 
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license MIT
 */

import { execSync } from 'child_process';
import {
  readPluginsConfig,
  writePluginsConfig,
  loadPlugin,
  loadAllPlugins,
  validatePlugin,
  isValidPluginName,
  discoverPlugins,
} from './loader.js';

// ============================================================================
// In-Memory Plugin Registry
// ============================================================================

/** @type {Map<string, Record<string, unknown>>} Loaded plugin instances keyed by name */
const loadedPlugins = new Map();

/** @type {Record<string, unknown>[]} All registered MCP tools from plugins */
const pluginTools = [];

/** @type {Record<string, unknown>[]} All registered scrapers from plugins */
const pluginScrapers = [];

/** @type {Record<string, unknown>[]} All registered Express routes from plugins */
const pluginRoutes = [];

/** @type {Record<string, unknown>[]} All registered browser actions from plugins */
const pluginActions = [];

/** @type {Record<string, unknown>[]} All registered hooks from plugins */
const pluginHooks = [];

// ============================================================================
// Plugin Installation
// ============================================================================

/**
 * Install a plugin by npm package name
 * @param {string} name - Package name (e.g., xactions-plugin-analytics)
 * @returns {Promise<Record<string, unknown>>} The installed plugin info
 */
export async function installPlugin(name) {
  // Allow local paths (starting with . or /)
  const isLocal = name.startsWith('.') || name.startsWith('/');

  if (!isLocal && !isValidPluginName(name)) {
    throw new Error(
      `Invalid plugin name "${name}". Plugins must be named "xactions-plugin-*" or "@xactions/*".`
    );
  }

  // Install via npm if it's a package name
  if (!isLocal) {
    try {
      execSync(`npm install ${name}`, { stdio: 'pipe', cwd: process.cwd() });
    } catch (error) {
      throw new Error(`Failed to install "${name}": ${(/** @type {Error} */ (error)).message}`);
    }
  }

  // Load and validate
  const plugin = /** @type {Record<string, unknown>} */ (await loadPlugin(name));

  // Register in config
  const config = await readPluginsConfig();
  const plugins = /** @type {Record<string, Record<string, unknown>>} */ (config.plugins || {});
  const pluginName = /** @type {string} */ (plugin.name);
  plugins[pluginName] = {
    package: name,
    path: isLocal ? name : undefined,
    version: plugin.version,
    description: plugin.description || '',
    enabled: true,
    installedAt: new Date().toISOString(),
  };
  await writePluginsConfig(config);

  // Load into memory
  await registerPlugin(plugin);

  const actions = Array.isArray(plugin.actions) ? /** @type {Record<string, unknown>[]} */ (plugin.actions) : [];
  const scrapers = Array.isArray(plugin.scrapers) ? /** @type {Record<string, unknown>[]} */ (plugin.scrapers) : [];
  const tools = Array.isArray(plugin.tools) ? /** @type {Record<string, unknown>[]} */ (plugin.tools) : [];
  const routes = Array.isArray(plugin.routes) ? /** @type {Record<string, unknown>[]} */ (plugin.routes) : [];

  return {
    name: pluginName,
    version: plugin.version,
    description: plugin.description,
    actions: actions.length,
    scrapers: scrapers.length,
    tools: tools.length,
    routes: routes.length,
  };
}

/**
 * Remove a plugin by name
 * @param {string} name - Plugin name (as declared in plugin.name)
 * @returns {Promise<boolean>}
 */
export async function removePlugin(name) {
  const config = await readPluginsConfig();
  const plugins = /** @type {Record<string, Record<string, unknown>>} */ (config.plugins || {});
  const entry = plugins[name];

  if (!entry) {
    throw new Error(`Plugin "${name}" is not installed.`);
  }

  // Unload from memory
  await unregisterPlugin(name);

  // Uninstall npm package if applicable
  const pkg = entry.package;
  if (pkg && !entry.path) {
    try {
      execSync(`npm uninstall ${pkg}`, { stdio: 'pipe', cwd: process.cwd() });
    } catch {
      // Non-fatal — config will be cleaned up regardless
    }
  }

  // Remove from config
  delete plugins[name];
  await writePluginsConfig(config);

  return true;
}

/**
 * List all registered plugins with their status
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function listPlugins() {
  const config = await readPluginsConfig();
  const plugins = /** @type {Record<string, Record<string, unknown>>} */ (config.plugins || {});
  return Object.entries(plugins).map(([name, entry]) => ({
    name,
    version: (/** @type {Record<string, unknown>} */ (entry)).version,
    description: (/** @type {Record<string, unknown>} */ (entry)).description,
    enabled: (/** @type {Record<string, unknown>} */ (entry)).enabled !== false,
    loaded: loadedPlugins.has(name),
    installedAt: (/** @type {Record<string, unknown>} */ (entry)).installedAt,
  }));
}

/**
 * Enable a plugin
 * @param {string} name
 */
export async function enablePlugin(name) {
  const config = await readPluginsConfig();
  const plugins = /** @type {Record<string, Record<string, unknown>>} */ (config.plugins || {});
  if (!plugins[name]) throw new Error(`Plugin "${name}" not found.`);
  plugins[name].enabled = true;
  await writePluginsConfig(config);

  // Load it
  const entry = plugins[name];
  const plugin = await loadPlugin((/** @type {string} */ (entry.path)) || (/** @type {string} */ (entry.package)) || name);
  await registerPlugin(plugin);
}

/**
 * Disable a plugin
 * @param {string} name
 */
export async function disablePlugin(name) {
  const config = await readPluginsConfig();
  const plugins = /** @type {Record<string, Record<string, unknown>>} */ (config.plugins || {});
  if (!plugins[name]) throw new Error(`Plugin "${name}" not found.`);
  plugins[name].enabled = false;
  await writePluginsConfig(config);

  await unregisterPlugin(name);
}

// ============================================================================
// Plugin Registration (in-memory)
// ============================================================================

/**
 * Register a plugin's exports into the in-memory registries
 * @param {Record<string, unknown>} plugin - Validated plugin module
 */
async function registerPlugin(plugin) {
  const name = /** @type {string} */ (plugin.name);
  if (loadedPlugins.has(name)) {
    await unregisterPlugin(name);
  }

  loadedPlugins.set(name, plugin);

  // Register tools
  const tools = plugin.tools;
  if (Array.isArray(tools)) {
    for (const tool of /** @type {Record<string, unknown>[]} */ (tools)) {
      pluginTools.push({ ...tool, _plugin: name });
    }
  }

  // Register scrapers
  const scrapers = plugin.scrapers;
  if (Array.isArray(scrapers)) {
    for (const scraper of /** @type {Record<string, unknown>[]} */ (scrapers)) {
      pluginScrapers.push({ ...scraper, _plugin: name });
    }
  }

  // Register routes
  const routes = plugin.routes;
  if (Array.isArray(routes)) {
    for (const route of /** @type {Record<string, unknown>[]} */ (routes)) {
      pluginRoutes.push({ ...route, _plugin: name });
    }
  }

  // Register actions
  const actions = plugin.actions;
  if (Array.isArray(actions)) {
    for (const action of /** @type {Record<string, unknown>[]} */ (actions)) {
      pluginActions.push({ ...action, _plugin: name });
    }
  }

  // Register hooks
  const hooks = /** @type {Record<string, unknown>} */ (plugin.hooks);
  if (hooks) {
    pluginHooks.push({ ...hooks, _plugin: name });
  }

  // Call onLoad lifecycle hook
  const onLoad = hooks?.onLoad;
  if (typeof onLoad === 'function') {
    try {
      await (/** @type {(...args: unknown[]) => Promise<unknown>} */ (onLoad))();
    } catch (error) {
      console.error(`⚠️  Plugin "${name}" onLoad hook failed: ${(/** @type {Error} */ (error)).message}`);
    }
  }
}

/**
 * Unregister a plugin and remove its contributions from memory
 * @param {string} name - Plugin name
 */
async function unregisterPlugin(name) {
  const plugin = loadedPlugins.get(name);
  if (!plugin) return;

  // Call onUnload lifecycle hook
  const hooks = /** @type {Record<string, unknown>} */ (plugin.hooks);
  const onUnload = hooks?.onUnload;
  if (typeof onUnload === 'function') {
    try {
      await (/** @type {(...args: unknown[]) => Promise<unknown>} */ (onUnload))();
    } catch (error) {
      console.error(`⚠️  Plugin "${name}" onUnload hook failed: ${(/** @type {Error} */ (error)).message}`);
    }
  }

  // Remove from all registries
  const removeByPlugin = (/** @type {Record<string, unknown>[]} */ arr) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if ((/** @type {Record<string, unknown>} */ (arr[i]))._plugin === name) arr.splice(i, 1);
    }
  };

  removeByPlugin(pluginTools);
  removeByPlugin(pluginScrapers);
  removeByPlugin(pluginRoutes);
  removeByPlugin(pluginActions);
  removeByPlugin(pluginHooks);

  loadedPlugins.delete(name);
}

// ============================================================================
// Hook Execution
// ============================================================================

/**
 * Execute a named hook across all loaded plugins
 * @param {string} hookName - Hook name (e.g., 'beforeAction', 'afterAction')
 * @param {Record<string, unknown>} context - Context passed to each hook function
 */
export async function executeHook(hookName, context = {}) {
  for (const hooks of pluginHooks) {
    const hook = hooks[hookName];
    if (typeof hook === 'function') {
      try {
        await (/** @type {(...args: unknown[]) => Promise<unknown>} */ (hook))(context);
      } catch (error) {
        console.error(`⚠️  Hook "${hookName}" in plugin "${(/** @type {string} */ (hooks._plugin))}" failed: ${(/** @type {Error} */ (error)).message}`);
      }
    }
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the plugin system — load all enabled plugins
 * @returns {Promise<number>} Number of plugins loaded
 */
export async function initializePlugins() {
  const plugins = await loadAllPlugins();

  for (const plugin of plugins) {
    await registerPlugin(plugin);
  }

  return plugins.length;
}

// ============================================================================
// Getters (for integration with MCP, API, scrapers)
// ============================================================================

/** Get all MCP tools contributed by plugins */
export function getPluginTools() {
  return [...pluginTools];
}

/** Get all scrapers contributed by plugins */
export function getPluginScrapers() {
  return [...pluginScrapers];
}

/** Get all Express routes contributed by plugins */
export function getPluginRoutes() {
  return [...pluginRoutes];
}

/** Get all browser actions contributed by plugins */
export function getPluginActions() {
  return [...pluginActions];
}

/** Get a loaded plugin by name
 * @param {string} name
 */
export function getPlugin(name) {
  return loadedPlugins.get(name);
}

/** Get count of loaded plugins */
export function getLoadedCount() {
  return loadedPlugins.size;
}

export default {
  installPlugin,
  removePlugin,
  listPlugins,
  enablePlugin,
  disablePlugin,
  initializePlugins,
  executeHook,
  getPluginTools,
  getPluginScrapers,
  getPluginRoutes,
  getPluginActions,
  getPlugin,
  getLoadedCount,
};
