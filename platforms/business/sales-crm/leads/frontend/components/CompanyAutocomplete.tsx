"use client";

// Sales CRM — Company autocomplete
// Adapted from intern source (src/components/ui/CompanyAutocomplete.tsx).
// The intern version has a second search path ("external"/Clearbit search)
// gated behind process.env.NEXT_PUBLIC_COMPANY_EXTERNAL_AUTOCOMPLETE_ENABLED
// that calls clearbit-service.ts, which in turn hits intern's own
// /api/companies/external-suggestions route. That route was never mounted
// in Apex (excluded from the very first Phase 1 inspection), and this env
// var is never set here, so that whole path is structurally unreachable —
// not simplified for convenience, removed because it cannot work: keeping
// the import would either break the build (no clearbit-service.ts ported)
// or silently 404 if someone later set the flag. Local company search +
// manual "add as new company" (LocalStorageCompanyRepository, already
// ported) is the only path that was ever reachable in this environment.

import { useState, useEffect, useRef, useId } from "react";
import { CompanyMaster } from "@apex/sales-crm-shared";
import { LocalStorageCompanyRepository } from "@/lib/sales-crm/company/company-repository";
import styles from "../styles/leads.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface CompanyAutocompleteProps {
    value: { companyName: string; companyId?: string };
    onChange: (value: { companyName: string; companyId?: string }) => void;
}

export default function CompanyAutocomplete({ value, onChange }: CompanyAutocompleteProps) {
    const [inputValue, setInputValue] = useState(value.companyName || "");
    const [internalResults, setInternalResults] = useState<CompanyMaster[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);

    const wrapperRef = useRef<HTMLDivElement>(null);
    const repoRef = useRef(new LocalStorageCompanyRepository());

    const listboxId = useId();

    useEffect(() => {
        repoRef.current.seed();
    }, []);

    useEffect(() => {
        // Clear companyId if user starts typing something else after selection
        if (value.companyName && inputValue !== value.companyName && value.companyId) {
            onChange({ companyName: inputValue, companyId: undefined });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inputValue]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (inputValue.length >= 2 && (!value.companyId || inputValue !== value.companyName)) {
                const results = repoRef.current.search(inputValue);
                setInternalResults(results);
                setIsOpen(true);
            } else if (inputValue.length < 2) {
                setInternalResults([]);
                setIsOpen(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [inputValue, value.companyName, value.companyId]);

    const handleSelectInternal = (company: CompanyMaster) => {
        setInputValue(company.displayName);
        onChange({ companyName: company.displayName, companyId: company.id });
        setIsOpen(false);
    };

    const handleManualAdd = () => {
        const newCompany = repoRef.current.save({
            displayName: inputValue,
            source: "manual"
        });
        setInputValue(newCompany.displayName);
        onChange({ companyName: newCompany.displayName, companyId: newCompany.id });
        setIsOpen(false);
    };

    const totalItems = internalResults.length + 1; // +1 for the manual-add action

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex(prev => (prev < totalItems - 1 ? prev + 1 : prev));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex(prev => (prev > 0 ? prev - 1 : 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (activeIndex >= 0) {
                if (activeIndex < internalResults.length) {
                    handleSelectInternal(internalResults[activeIndex]);
                } else {
                    handleManualAdd();
                }
            }
        } else if (e.key === "Escape") {
            setIsOpen(false);
        }
    };

    return (
        <div className={styles["company-autocomplete-wrapper"]} ref={wrapperRef}>
            <input
                type="text"
                className={ui["ui-input"]}
                name="company_autocomplete"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                value={inputValue}
                onChange={(e) => {
                    setInputValue(e.target.value);
                    onChange({ companyName: e.target.value, companyId: undefined });
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (inputValue.length >= 2) setIsOpen(true); }}
                placeholder="Type to search companies..."
                role="combobox"
                aria-expanded={isOpen}
                aria-autocomplete="list"
                aria-controls={isOpen ? listboxId : undefined}
                aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            />

            {isOpen && inputValue.length >= 2 && (
                <ul
                    id={listboxId}
                    className={styles["company-autocomplete-list"]}
                    role="listbox"
                >
                    {internalResults.length > 0 && (
                        <li className={styles["company-autocomplete-group"]} role="presentation">CRM Company</li>
                    )}

                    {internalResults.map((company, idx) => (
                        <li
                            id={`${listboxId}-option-${idx}`}
                            key={company.id}
                            className={`${styles["company-autocomplete-item"]} ${activeIndex === idx ? styles["company-autocomplete-item--active"] : ""}`}
                            role="option"
                            aria-selected={activeIndex === idx}
                            onClick={() => handleSelectInternal(company)}
                            onMouseEnter={() => setActiveIndex(idx)}
                        >
                            <div className={styles["company-autocomplete-name"]}>{company.displayName}</div>
                            {company.domain && <div className={styles["company-autocomplete-domain"]}>{company.domain}</div>}
                        </li>
                    ))}

                    <li
                        id={`${listboxId}-option-${internalResults.length}`}
                        className={`${styles["company-autocomplete-action"]} ${activeIndex === internalResults.length ? styles["company-autocomplete-action--active"] : ""}`}
                        role="option"
                        aria-selected={activeIndex === internalResults.length}
                        onClick={handleManualAdd}
                        onMouseEnter={() => setActiveIndex(internalResults.length)}
                    >
                        {`Add "${inputValue}" as a new company`}
                    </li>
                </ul>
            )}
        </div>
    );
}
