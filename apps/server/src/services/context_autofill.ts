import type { ActionSpec, SessionContext } from '../types.js';
import * as contextProfiles from './context_profiles.js';

function isEmptyInputValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getPathValue(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function actionHasContextBindings(action: ActionSpec): boolean {
  return action.inputs.some((input) => Boolean(input.context));
}

/**
 * Fill missing input values from the caller's stored JSON profiles.
 *
 * Security contract:
 * - Only runs when the caller explicitly opts in (`use_context: true`).
 * - Only manifest-declared input bindings are read.
 * - Explicit user-supplied inputs always win.
 * - Resolved values are normal run inputs after this point, so normal run
 *   ownership/redaction rules apply.
 */
export function resolveContextInputs(
  ctx: SessionContext,
  action: ActionSpec,
  rawInputs: Record<string, unknown>,
  useContext = false,
): Record<string, unknown> {
  if (!useContext || !actionHasContextBindings(action)) return rawInputs;

  let userProfile: Record<string, unknown> | null = null;
  let workspaceProfile: Record<string, unknown> | null = null;
  const resolved: Record<string, unknown> = { ...rawInputs };

  for (const input of action.inputs) {
    if (!input.context || !isEmptyInputValue(resolved[input.name])) continue;

    const source =
      input.context.source === 'user_profile'
        ? (userProfile ??= contextProfiles.getUserProfile(ctx))
        : (workspaceProfile ??= contextProfiles.getWorkspaceProfile(ctx).profile);
    const value = getPathValue(source, input.context.path);
    if (value !== undefined) {
      resolved[input.name] = cloneJsonValue(value);
    }
  }

  return resolved;
}
