// Sales CRM — Company master repository
// Ported from intern source (src/lib/company/company-repository.ts). Storage
// key renamed from the generic "crm_company_master" to a namespaced key.
// Note: clearbit-service.ts was intentionally not ported (Phase 1 excludes
// the external company-suggestions API route it was built for), so this
// repository is local-storage-only, same as the intern's own fallback path.

import { CompanyMaster, MOCK_LEADS } from "@apex/sales-crm-shared";
import { normalizeCompanyName, normalizeDomain } from "./normalization";
import { MOCK_CLIENTS } from "@apex/sales-crm-shared/lib/database-data";

export interface CompanyRepository {
  search(query: string): CompanyMaster[];
  save(company: Partial<CompanyMaster>): CompanyMaster;
  seed(): void;
  getById(id: string): CompanyMaster | undefined;
}

const STORAGE_KEY = "salescrm_company_master";

export class LocalStorageCompanyRepository implements CompanyRepository {
  private getStore(): CompanyMaster[] {
    if (typeof window === "undefined") return [];
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }

  private setStore(data: CompanyMaster[]): void {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }

  seed(): void {
    if (typeof window === "undefined") return;
    const existing = this.getStore();
    if (existing.length > 0) return; // Already seeded

    const seedCompanies: CompanyMaster[] = [];

    // Process MOCK_LEADS
    MOCK_LEADS.forEach((lead) => {
      if (lead.company) {
        this.addSeedCompany(seedCompanies, lead.company);
      }
    });

    // Process MOCK_CLIENTS
    MOCK_CLIENTS.forEach((client) => {
      if (client.company_name) {
        this.addSeedCompany(seedCompanies, client.company_name);
      }
    });

    this.setStore(seedCompanies);
  }

  private addSeedCompany(store: CompanyMaster[], name: string) {
    const normalized = normalizeCompanyName(name);
    // Don't duplicate exact normalized names during initial seed
    if (!store.find(c => c.normalizedName === normalized)) {
      store.push({
        id: `cm-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        displayName: name,
        normalizedName: normalized,
        source: "migrated",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true
      });
    }
  }

  search(query: string): CompanyMaster[] {
    const store = this.getStore();
    if (!query || query.length < 2) return [];

    const normQuery = normalizeCompanyName(query);
    const domainQuery = normalizeDomain(query);

    return store
      .filter(c => c.isActive)
      .map(company => {
        let score = 0;

        // Exact normalized name match
        if (company.normalizedName === normQuery) score += 100;
        // Exact domain match
        else if (company.normalizedDomain && company.normalizedDomain === domainQuery) score += 90;
        // Prefix match
        else if (company.normalizedName.startsWith(normQuery)) score += 50;
        // Substring match
        else if (company.normalizedName.includes(normQuery)) score += 10;

        return { company, score };
      })
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(result => result.company)
      .slice(0, 10);
  }

  save(companyData: Partial<CompanyMaster>): CompanyMaster {
    const store = this.getStore();

    if (companyData.id) {
      const index = store.findIndex(c => c.id === companyData.id);
      if (index !== -1) {
        const updated = { ...store[index], ...companyData, updatedAt: new Date().toISOString() };
        store[index] = updated;
        this.setStore(store);
        return updated;
      }
    }

    // Exact domain match -> Reuse
    if (companyData.domain) {
        const normDomain = normalizeDomain(companyData.domain);
        const existingByDomain = store.find(c => c.normalizedDomain === normDomain);
        if (existingByDomain) {
            return existingByDomain;
        }
    }

    const newCompany: CompanyMaster = {
      id: `cm-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      displayName: companyData.displayName || "Unknown",
      normalizedName: normalizeCompanyName(companyData.displayName || ""),
      legalName: companyData.legalName,
      domain: companyData.domain,
      normalizedDomain: companyData.domain ? normalizeDomain(companyData.domain) : undefined,
      city: companyData.city,
      countryCode: companyData.countryCode,
      source: companyData.source || "manual",
      sourceReference: companyData.sourceReference,
      createdBy: companyData.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true
    };

    store.push(newCompany);
    this.setStore(store);
    return newCompany;
  }

  getById(id: string): CompanyMaster | undefined {
      return this.getStore().find(c => c.id === id);
  }
}
