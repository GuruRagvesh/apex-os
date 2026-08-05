// Sales CRM — Country dial code data
// Ported from intern source (src/lib/country-codes.ts). Data file
// (countries.json) copied verbatim alongside this one.

import countriesData from "./data/countries.json";

export interface CountryCodeOption {
  name: string;
  iso2: string;
  dialCode: string;
  flag: string;
}

// Load and sort country codes
export function getCountryCodes(): CountryCodeOption[] {
  const sorted = [...(countriesData as CountryCodeOption[])].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return sorted;
}

export function getDefaultCountryCode(): string {
  return "+91"; // Default to India
}
