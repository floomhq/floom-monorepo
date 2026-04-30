'use strict';

const { normalizeUrl, providerFetch } = require('./http');
const { sleep } = require('../util');

const DEFAULT_VERCEL_API_URL = 'https://api.vercel.com';
const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;
const DEPLOY_POLL_MS = 5 * 1000;

function assertId(label, id, response) {
  if (typeof id !== 'string' || !id || !/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error(`${label} response did not include a valid id: ${JSON.stringify(response)}`);
  }
  return id;
}

function normalizeProject(json, fallbackName) {
  const id = assertId('vercel project', String(json.id || json.projectId || json.name || ''), json);
  return {
    id,
    url: normalizeUrl(json.url || json.link || `${fallbackName}.vercel.app`),
  };
}

function normalizeDeployment(json) {
  const id = assertId('vercel deployment', String(json.id || json.uid || ''), json);
  return {
    id,
    readyState: String(json.readyState || json.state || ''),
    deploymentUrl: normalizeUrl(json.url || json.deploymentUrl || json.inspectorUrl),
  };
}

function createVercelProvider({ token, baseUrl = process.env.FLOOM_BYO_VERCEL_API_URL || DEFAULT_VERCEL_API_URL } = {}) {
  const teamId = process.env.FLOOM_BYO_VERCEL_TEAM_ID || '';
  const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';

  async function getProjectByName(name) {
    const { json } = await providerFetch(baseUrl, `/v9/projects/${encodeURIComponent(name)}${teamQuery}`, token, {
      method: 'GET',
      label: 'vercel get project',
    });
    return normalizeProject(json || {}, name);
  }

  async function getStatus(deploymentId) {
    const { json } = await providerFetch(baseUrl, `/v13/deployments/${encodeURIComponent(deploymentId)}${teamQuery}`, token, {
      method: 'GET',
      label: 'vercel get deployment',
    });
    return normalizeDeployment(json || {});
  }

  async function waitForDeployment(initial, options = {}) {
    let current = initial;
    const timeoutMs = options.timeoutMs || Number(process.env.FLOOM_BYO_VERCEL_DEPLOY_TIMEOUT_MS || DEPLOY_TIMEOUT_MS);
    const pollMs = options.pollMs || Number(process.env.FLOOM_BYO_VERCEL_DEPLOY_POLL_MS || DEPLOY_POLL_MS);
    const deadline = Date.now() + timeoutMs;
    while (current.readyState !== 'READY') {
      if (current.readyState === 'ERROR') {
        throw new Error(`vercel deployment ${current.id} failed: ${JSON.stringify(current)}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`vercel deployment ${current.id} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      await sleep(pollMs);
      current = await getStatus(current.id);
    }
    return current;
  }

  return {
    async createProject(name, repo, config = {}, options = {}) {
      const body = {
        name,
        rootDirectory: '.',
        gitRepository: repo ? { type: 'github', repo } : undefined,
        buildCommand: config.build_command || undefined,
        outputDirectory: config.output_dir || undefined,
        framework: config.framework || undefined,
      };
      Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
      try {
        const { json } = await providerFetch(baseUrl, `/v9/projects${teamQuery}`, token, {
          method: 'POST',
          body,
          label: 'vercel create project',
        });
        return normalizeProject(json || {}, name);
      } catch (err) {
        if (!options.forceRecreate && err.status === 409) {
          return getProjectByName(name);
        }
        throw err;
      }
    },

    async setEnv(projectId, vars) {
      for (const [key, value] of Object.entries(vars || {})) {
        await providerFetch(baseUrl, `/v10/projects/${encodeURIComponent(projectId)}/env${teamQuery}`, token, {
          method: 'POST',
          body: {
            key,
            value,
            type: 'encrypted',
            target: ['production'],
          },
          label: `vercel set env ${key}`,
        });
      }
    },

    async deploy(projectId, gitRef, options = {}) {
      const { json } = await providerFetch(baseUrl, `/v13/deployments${teamQuery}`, token, {
        method: 'POST',
        body: {
          project: projectId,
          target: options.target || 'production',
          gitSource: gitRef ? { type: 'github', ref: gitRef } : undefined,
        },
        label: 'vercel deploy',
      });
      const initial = normalizeDeployment(json || {});
      const finalDeployment = await waitForDeployment(initial, options);
      return {
        id: finalDeployment.id,
        deploymentUrl: finalDeployment.deploymentUrl,
      };
    },

    getStatus,

    async rollback(deploymentId) {
      const { json } = await providerFetch(baseUrl, `/v13/deployments/${encodeURIComponent(deploymentId)}/rollback${teamQuery}`, token, {
        method: 'POST',
        body: {},
        label: 'vercel rollback',
      });
      return normalizeDeployment(json || {});
    },

    async createPreview(projectId, gitRef) {
      return this.deploy(projectId, gitRef, { target: 'preview' });
    },

    async addDomain(projectId, host) {
      const { json } = await providerFetch(baseUrl, `/v10/projects/${encodeURIComponent(projectId)}/domains${teamQuery}`, token, {
        method: 'POST',
        body: { name: host },
        label: 'vercel add domain',
      });
      return json;
    },
  };
}

module.exports = {
  createVercelProvider,
};
