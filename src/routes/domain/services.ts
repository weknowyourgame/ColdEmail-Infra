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

export class CloudflareService {
    private baseUrl = 'https://api.cloudflare.com/client/v4';
    
    constructor(private apiToken: string) {}
    private async cfRequest<T>(
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
        // Check zone exists
        const zone = await this.cfRequest<CloudflareResponse>("GET", `/zones?name=${domain}`);
        
        if (!zone.result?.length) {
          throw new Error('Domain not found in Cloudflare');
        }
  
        // Get DNS records
        const records = await this.cfRequest<CloudflareResponse>(`/zones/${zone.result[0].id}/dns_records`);
        
        // Verify required records exist
        const hasSpf = records.result.some((r: CloudflareRecord) => r.type === 'TXT' && r.content.includes('v=spf1'));
        const hasDmarc = records.result.some((r: CloudflareRecord) => r.type === 'TXT' && r.name.includes('_dmarc'));
        const hasDkim = records.result.some((r: CloudflareRecord) => r.type === 'CNAME' && r.name.includes('_domainkey'));
        
        return {
          success: true,
          domain,
          records: {
            spf: hasSpf,
            dmarc: hasDmarc,
            dkim: hasDkim
          }
        };
      } catch (error) {
        console.error('Verification error:', error);
        throw error;
      }
    }
  }
  
export type DomainRouter = typeof domainRouter;
