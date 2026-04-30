export type ByoDatabaseProviderName = 'supabase';
export type ByoHostingProviderName = 'vercel';
export type ByoSandboxProviderName = 'e2b';

export type TableColumnType =
  | 'text'
  | 'text[]'
  | 'varchar'
  | 'uuid'
  | 'integer'
  | 'bigint'
  | 'bigint[]'
  | 'numeric'
  | 'boolean'
  | 'bytea'
  | 'json'
  | 'jsonb'
  | 'jsonb[]'
  | 'timestamp'
  | 'timestamptz'
  | `vector(${number})`;

export interface TableColumnSchema {
  name: string;
  type: TableColumnType | string;
  primary_key?: boolean;
  nullable?: boolean;
  required?: boolean;
  default?: string | number | boolean | null;
  references?: string;
}

export interface TableSchema {
  name: string;
  columns: TableColumnSchema[];
  tenant_scope?: 'workspace' | 'global';
}

export interface ByoDatabaseConfig {
  provider: ByoDatabaseProviderName;
  project_name?: string;
  account?: string;
  tables?: TableSchema[];
}

export interface ByoHostingConfig {
  provider: ByoHostingProviderName;
  project_name?: string;
  account?: string;
  repo?: string;
  build_command?: string;
  output_dir?: string;
}

export interface ByoSandboxConfig {
  provider: ByoSandboxProviderName;
  account?: string;
  template: string;
  image?: string;
}

export interface ByoRuntimeConfig {
  database?: ByoDatabaseConfig;
  hosting?: ByoHostingConfig;
  sandbox?: ByoSandboxConfig;
}

export interface DatabaseProject {
  id: string;
  url: string;
  anonKey: string;
  connectionString?: string;
}

export interface HostingProject {
  id: string;
  url: string;
}

export interface DeploymentResult {
  id?: string;
  deploymentUrl: string;
}

export interface SandboxTemplate {
  templateId: string;
}

export interface SandboxRunResult {
  runId: string;
  outputs: unknown;
}

export interface RlsPolicy {
  using?: string;
  check?: string;
  roles?: string[];
}

export interface DatabaseProvider {
  createProject(name: string, options?: { forceRecreate?: boolean }): Promise<DatabaseProject>;
  applyMigrations(projectId: string, manifestSchema: TableSchema[]): Promise<void>;
  read(table: string, where: Record<string, unknown>): Promise<unknown[]>;
  write(table: string, row: Record<string, unknown>): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<unknown>;
  transaction<T>(fn: (tx: DatabaseProvider) => Promise<T> | T): Promise<T>;
  configureRLS(table: string, policy: RlsPolicy): Promise<unknown>;
}

export interface HostingProvider {
  createProject(
    name: string,
    repo: string,
    config?: Pick<ByoHostingConfig, 'build_command' | 'output_dir'>,
    options?: { forceRecreate?: boolean },
  ): Promise<HostingProject>;
  setEnv(projectId: string, vars: Record<string, string>): Promise<void>;
  deploy(projectId: string, gitRef: string): Promise<DeploymentResult>;
  getStatus(deploymentId: string): Promise<DeploymentResult & { readyState?: string }>;
  rollback(deploymentId: string): Promise<DeploymentResult>;
  createPreview(projectId: string, gitRef: string): Promise<DeploymentResult>;
  addDomain(projectId: string, host: string): Promise<unknown>;
}

export interface SandboxProvider {
  createTemplate(image: string): Promise<SandboxTemplate>;
  spawn(templateId: string, inputs: unknown): Promise<SandboxRunResult>;
  streamLogs(runId: string): AsyncIterable<string>;
  kill(runId: string): Promise<unknown>;
  getQuota(account?: string): Promise<unknown>;
}

// Cloud Phase 2 can implement these same minimal interfaces with Floom-owned
// adapters, while BYO implementations bind them to user-owned vendor accounts.
export interface EmailProvider {
  send(to: string, subject: string, body: string): Promise<unknown>;
}

export interface BillingProvider {
  createCheckout(customerId: string, priceId: string): Promise<{ url: string }>;
}

export interface AuthProvider {
  verifySession(token: string): Promise<{ userId: string; workspaceId?: string } | null>;
}

export interface ObservabilityProvider {
  capture(event: string, payload: Record<string, unknown>): Promise<void>;
}

export interface AnalyticsProvider {
  track(userId: string, event: string, properties?: Record<string, unknown>): Promise<void>;
}

export interface RateLimitProvider {
  check(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }>;
}

export interface WebhookProvider {
  register(event: string, url: string): Promise<{ id: string }>;
  deliver(event: string, payload: unknown): Promise<unknown>;
}
