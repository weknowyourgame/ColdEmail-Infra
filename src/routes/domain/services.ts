import { domainRouter } from ".";
import { DomainSetup } from "../../types";
import { setupDomainSchema } from "./schemas";
import { z } from "zod";

interface CloudflareRecord {
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
}

interface CloudflareZone {
  id: string;
  name: string;
  name_servers: string[];
}

interface CloudflareResponse {
  success: boolean;
  errors: any[];
  result: any;
}

interface CloudflareRecordResponse {
  success: boolean;
  errors: any[];
  result: {
    id: string;
    type: string;
    name: string;
    content: string;
  };
}

interface PageRule {
  targets: Array<{
    target: string;
    constraint: {
      operator: string;
      value: string;
    };
  }>;
  actions: Array<{
    id: string;
    value: {
      url: string;
      status_code: number;
    };
  }>;
  status: string;
}

interface PageRuleResponse extends CloudflareResponse {
  result: {
    id: string;
    targets: Array<{
      target: string;
      constraint: {
        operator: string;
        value: string;
      };
    }>;
    actions: Array<{
      id: string;
      value: {
        url: string;
        status_code: number;
      };
    }>;
    status: string;
  };
}

export class CloudflareService {
    private baseUrl = 'https://api.cloudflare.com/client/v4';
    
    constructor(private apiToken: string) {}
    protected async cfRequest<T>(
      method: string,
      endpoint: string,
      data?: unknown
    ): Promise<T> {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          "Authorization": `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: data ? JSON.stringify(data) : undefined,
      });
  
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.errors?.[0]?.message || "Cloudflare API error");
      }
  
      return result as T;
    }
  
    public async makeRequest<T>(
      method: string,
      endpoint: string,
      data?: unknown
    ): Promise<T> {
      return this.cfRequest<T>(method, endpoint, data);
    }
  
    async verifyDomain(domain: string) {
      try {
        const result = await this.cfRequest('GET', `/zones?name=${domain}`);
        return {
          available: result.result.length === 0,
          domain
        };
      } catch (error) {
        console.error('Domain verification error:', error);
        throw error;
      }
    }

    async setupDomainAndEmail(config: DomainSetup) {
      try {
        // Create zone
        const zone = await this.cfRequest<CloudflareResponse>('POST', '/zones', {
          name: config.domain,
          jump_start: true,
        });
  
        const records: CloudflareRecord[] = [
          // SPF Record
          {
            type: "TXT",
            name: "@",
            content: "v=spf1 include:_spf.mx.cloudflare.net include:spf.protection.outlook.com -all",
            ttl: 3600,
            proxied: false
          },
          // DKIM Records for Microsoft 365
          {
            type: "CNAME",
            name: "selector1._domainkey",
            content: `selector1-${config.domain}._domainkey.onmicrosoft.com`,
            ttl: 3600,
            proxied: false
          },
          {
            type: "CNAME",
            name: "selector2._domainkey",
            content: `selector2-${config.domain}._domainkey.onmicrosoft.com`,
            ttl: 3600,
            proxied: false
          },
          // DMARC Record
          {
            type: "TXT",
            name: "_dmarc",
            content: `v=DMARC1; p=quarantine; rua=mailto:${config.reportEmail}; ruf=mailto:${config.reportEmail}; fo=1`,
            ttl: 3600,
            proxied: false
          },
          // MX Records for Microsoft 365
          {
            type: "MX",
            name: "@",
            content: "outlook-com.office365.com",
            priority: 0,
            ttl: 3600,
            proxied: false
          },
          // TXT Record for Microsoft 365 Domain Verification
          {
            type: "TXT",
            name: "@",
            content: "MS=ms12345678",
            ttl: 3600,
            proxied: false
          }
        ];
  
        // Setup all DNS records
        const dnsResults = await Promise.all(
          records.map(record => 
            this.cfRequest<CloudflareRecordResponse>("POST", `/zones/${zone.result.id}/dns_records`, record)
          )
        );
  
        return {
          success: true,
          zoneId: zone.result.id,
          nameservers: zone.result.name_servers,
          records: dnsResults.map(r => ({
            type: r.result.type,
            name: r.result.name,
            content: r.result.content
          }))
        };
      } catch (error) {
        console.error('Setup error:', error);
        throw error;
      }
    }
  
    // Method to verify domain setup
    async verifyDomainSetup(domain: string) {
      try {
        // Get zone info
        const zoneResponse = await this.cfRequest<CloudflareResponse>("GET", `/zones?name=${domain}`);
        
        if (!zoneResponse.result?.length) {
          return {
            success: false,
            domain,
            error: "Domain not found in Cloudflare"
          };
        }

        const zoneId = zoneResponse.result[0].id;

        // Get DNS records
        const recordsResponse = await this.cfRequest<CloudflareResponse>(`/zones/${zoneId}/dns_records`);
        
        // Verify required records
        const hasSpf = recordsResponse.result.some((r: CloudflareRecord) => 
          r.type === 'TXT' && r.content.includes('v=spf1')
        );
        const hasDmarc = recordsResponse.result.some((r: CloudflareRecord) => 
          r.type === 'TXT' && r.name.includes('_dmarc')
        );
        const hasDkim = recordsResponse.result.some((r: CloudflareRecord) => 
          r.type === 'CNAME' && r.name.includes('_domainkey')
        );

        return {
          success: true,
          domain,
          zoneId,
          nameservers: zoneResponse.result[0].name_servers,
          records: {
            spf: hasSpf,
            dmarc: hasDmarc,
            dkim: hasDkim
          }
        };
      } catch (error) {
        console.error('Domain verification error:', error);
        throw new Error(`Failed to verify domain: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    async createDomain(domainName: string) {
      try {
        const response = await this.cfRequest('POST', '/zones', {
          name: domainName,
          jump_start: true
        });

        return {
          nameServers: response.result.name_servers || [],
          zoneId: response.result.id,
        };
      } catch (error) {
        console.error("Create Domain Error:", error);
        throw error;
      }
    }

    async updateRedirect(zoneId: string, domain: string, redirectUrl: string) {
      try {
        const pageRuleConfig = {
          targets: [
            {
              target: "url",
              constraint: {
                operator: "matches",
                value: `*${domain}/*` // Make sure pattern matches Cloudflare format
              }
            }
          ],
          actions: [
            {
              id: "forwarding_url",
              value: {
                url: redirectUrl,
                status_code: 301
              }
            }
          ],
          status: "active",
          priority: 1
        };

        // First try to find existing rules
        const existingRules = await this.cfRequest<CloudflareResponse>(
          "GET",
          `/zones/${zoneId}/pagerules`
        );

        const existingRule = existingRules.result?.find((rule: any) => 
          rule.targets?.[0]?.constraint?.value?.includes(domain)
        );

        if (existingRule) {
          // Update existing rule
          return await this.cfRequest<CloudflareResponse>(
            "PUT",
            `/zones/${zoneId}/pagerules/${existingRule.id}`,
            pageRuleConfig
          );
        }

        // Create new rule
        return await this.cfRequest<CloudflareResponse>(
          "POST",
          `/zones/${zoneId}/pagerules`,
          pageRuleConfig
        );
      } catch (error) {
        console.error('Update redirect error:', error);
        throw new Error(`Failed to update redirect: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    async getRedirects(zoneId: string) {
      try {
        const response = await this.cfRequest<CloudflareResponse>(
          "GET",
          `/zones/${zoneId}/pagerules`
        );

        return {
          success: true,
          redirects: response.result.map((rule: any) => ({
            id: rule.id,
            target: rule.targets[0]?.constraint?.value,
            redirectTo: rule.actions[0]?.value?.url,
            status: rule.status
          }))
        };
      } catch (error) {
        console.error('Get redirects error:', error);
        throw new Error(`Failed to get redirects: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    async deleteRedirect(zoneId: string, ruleId: string) {
      try {
        await this.cfRequest<CloudflareResponse>(
          "DELETE",
          `/zones/${zoneId}/pagerules/${ruleId}`
        );
        
        return {
          success: true,
          message: "Redirect rule deleted successfully"
        };
      } catch (error) {
        console.error('Delete redirect error:', error);
        throw new Error(`Failed to delete redirect: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }
  
export type DomainRouter = typeof domainRouter;
