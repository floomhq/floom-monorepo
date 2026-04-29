export type ByoDatabaseProviderName = 'supabase';
export type ByoHostingProviderName = 'vercel';
export type ByoSandboxProviderName = 'e2b';

export type TableColumnType =
  | 'text'
  | 'varchar'
  | 'uuid'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'boolean'
  | 'json'
  | 'jsonb'
  | 'timestamp'
  | 'timestamptz';

export interface TableColumnSchema {
  name: string;
  type: TableColumnType | string;
  primary_key?: boolean;
  nullable?: boolean;
  default?: string | number | boolean | null;
  references?: string;
}

export interface TableSchema {
  name: string;
  columns: TableColumnSchema[];
}

export interface ByoDatabaseConfig {
  provider: ByoDatabaseProviderName;
  project_name?: string;
  tables?: TableSchema[];
}

export interface ByoHostingConfig {
  provider: ByoHostingProviderName;
  project_name?: string;
  build_command?: string;
  output_dir?: string;
}

export interface ByoSandboxConfig {
  provider: ByoSandboxProviderName;
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
  deploymentUrl: string;
}

export interface SandboxTemplate {
  templateId: string;
}

export interface SandboxRunResult {
  runId: string;
  outputs: unknown;
}

export interface DatabaseProvider {
  createProject(name: string): Promise<DatabaseProject>;
  applyMigrations(projectId: string, manifestSchema: TableSchema[]): Promise<void>;
}

export interface HostingProvider {
  createProject(name: string, repo: string): Promise<HostingProject>;
  setEnv(projectId: string, vars: Record<string, string>): Promise<void>;
  deploy(projectId: string, gitRef: string): Promise<DeploymentResult>;
}

export interface SandboxProvider {
  createTemplate(image: string): Promise<SandboxTemplate>;
  spawn(templateId: string, inputs: unknown): Promise<SandboxRunResult>;
}
