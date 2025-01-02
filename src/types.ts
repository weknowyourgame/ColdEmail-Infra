export interface Env {
  CF_API_TOKEN: string;
  KV: KVNamespace;
  JWT_SECRET: string;
}

export interface DomainSetup {
  domain: string;
  redirectTo: string;
  reportEmail: string;
}

export interface CloudflareResponse {
  success: boolean;
  errors: any[];
  result: any;
}