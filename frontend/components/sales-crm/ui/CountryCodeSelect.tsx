"use client";

// Sales CRM — Country code select
// Ported from intern source (src/components/ui/CountryCodeSelect.tsx).
// Shared by LeadCreate.tsx (phone + alternate phone). Styles come from
// leads.module.css's lead-country-* classes since Leads is this
// component's first real consumer.

import { useState, useRef, useEffect, useMemo } from "react";
import { getCountryCodes, getDefaultCountryCode } from "@apex/sales-crm-shared";
import { Search, ChevronDown } from "lucide-react";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface CountryCodeSelectProps {
  value: string;
  onChange: (code: string) => void;
  className?: string;
}

export default function CountryCodeSelect({ value, onChange, className = "" }: CountryCodeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const countries = useMemo(() => getCountryCodes(), []);

  // Find the selected country object
  const selectedCountry = useMemo(() => {
    return countries.find(c => c.dialCode === value) ||
           countries.find(c => c.dialCode === getDefaultCountryCode()) ||
           countries[0];
  }, [value, countries]);

  const filteredCountries = useMemo(() => {
    const q = search.toLowerCase();
    return countries.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.dialCode.includes(q)
    );
  }, [search, countries]);

  // Handle outside click to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (code: string) => {
    onChange(code);
    setIsOpen(false);
    setSearch("");
  };

  return (
    <div className={`${styles["lead-country-code-select"]} ${className}`} ref={dropdownRef}>
      <button
        type="button"
        className={`${styles["lead-country-select-trigger"]} ${ui["ui-select"]}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={styles["lead-country-selected"]}>
          <span className={styles["lead-country-flag"]}>{selectedCountry?.flag}</span>
          <span className={styles["lead-country-dial"]}>{selectedCountry?.dialCode}</span>
        </span>
        <ChevronDown size={14} className={styles["lead-country-chevron"]} />
      </button>

      {isOpen && (
        <div className={styles["lead-country-dropdown"]}>
          <div className={styles["lead-country-search-box"]}>
            <Search size={14} className={styles["lead-country-search-icon"]} />
            <input
              type="text"
              className={styles["lead-country-search-input"]}
              placeholder="Search country or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <ul className={styles["lead-country-list"]} role="listbox">
            {filteredCountries.length > 0 ? (
              filteredCountries.map((country) => (
                <li
                  key={`${country.iso2}-${country.dialCode}`}
                  className={`${styles["lead-country-item"]} ${country.dialCode === value ? 'selected' : ''}`}
                  onClick={() => handleSelect(country.dialCode)}
                  role="option"
                  aria-selected={country.dialCode === value}
                >
                  <span className={styles["lead-country-flag"]}>{country.flag}</span>
                  <span className={styles["lead-country-name"]}>{country.name}</span>
                  <span className={styles["lead-country-dial-code"]}>{country.dialCode}</span>
                </li>
              ))
            ) : (
              <li className={styles["lead-country-empty"]}>No countries found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
