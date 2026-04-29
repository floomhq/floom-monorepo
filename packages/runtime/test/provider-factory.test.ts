import { getDefaultProvider } from '../src/runtime/index.ts';
import { Ax41DockerProvider, DOCKER_HARDENING_ARGS } from '../src/provider/ax41-docker.ts';

let passed = 0;
let failed = 0;

function log(label, ok) {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
  }
}

console.log('Runtime Provider Factory & Hardening Tests');

// 1. Check hardening constants
log('DOCKER_HARDENING_ARGS contains no-new-privileges', DOCKER_HARDENING_ARGS.includes('--security-opt') && DOCKER_HARDENING_ARGS.includes('no-new-privileges:true'));
log('DOCKER_HARDENING_ARGS drops ALL capabilities', DOCKER_HARDENING_ARGS.includes('--cap-drop') && DOCKER_HARDENING_ARGS.includes('ALL'));
log('DOCKER_HARDENING_ARGS has --read-only', DOCKER_HARDENING_ARGS.includes('--read-only'));
log('DOCKER_HARDENING_ARGS has --pids-limit', DOCKER_HARDENING_ARGS.includes('--pids-limit'));

// 2. Check factory
process.env.FLOOM_RUNTIME_PROVIDER = 'ax41-docker';
const provider = getDefaultProvider();
log('getDefaultProvider returns Ax41DockerProvider', provider instanceof Ax41DockerProvider);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
