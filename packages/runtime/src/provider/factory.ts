import type { RuntimeProvider } from './types.js';
import { Ax41DockerProvider } from './ax41-docker.js';

/**
 * getDefaultProvider — returns the RuntimeProvider configured for this
 * environment. Defaults to ax41-docker (local/AX41 Docker daemon).
 */
export function getDefaultProvider(): RuntimeProvider {
  const name = process.env.FLOOM_RUNTIME_PROVIDER || 'ax41-docker';

  switch (name) {
    case 'ax41-docker':
      return new Ax41DockerProvider();
    default:
      throw new Error(`Unknown FLOOM_RUNTIME_PROVIDER: ${name}`);
  }
}
