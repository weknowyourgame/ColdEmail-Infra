export interface Env {
  CF_API_TOKEN: string;
  KV: KVNamespace;
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