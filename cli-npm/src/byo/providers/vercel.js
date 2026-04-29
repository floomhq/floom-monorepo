'use strict';

const { normalizeUrl, providerFetch } = require('./http');

const DEFAULT_VERCEL_API_URL = 'https://api.vercel.com';

function createVercelProvider({ token, baseUrl = process.env.FLOOM_BYO_VERCEL_API_URL || DEFAULT_VERCEL_API_URL } = {}) {
  const teamId = process.env.FLOOM_BYO_VERCEL_TEAM_ID || '';
  const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';

  return {
    async createProject(name, repo) {
      const { json } = await providerFetch(baseUrl, `/v9/projects${teamQuery}`, token, {
        method: 'POST',
        body: {
          name,
          rootDirectory: '.',
          gitRepository: repo ? { type: 'github', repo } : undefined,
        },
        label: 'vercel create project',
      });
      return {
        id: String(json.id || json.projectId || json.name),
        url: normalizeUrl(json.url || json.link || `${name}.vercel.app`),
      };
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

    async deploy(projectId, gitRef) {
      const { json } = await providerFetch(baseUrl, `/v13/deployments${teamQuery}`, token, {
        method: 'POST',
        body: {
          project: projectId,
          target: 'production',
          gitSource: gitRef ? { type: 'github', ref: gitRef } : undefined,
        },
        label: 'vercel deploy',
      });
      return {
        deploymentUrl: normalizeUrl(json.url || json.deploymentUrl || json.inspectorUrl),
      };
    },
  };
}

module.exports = {
  createVercelProvider,
};
