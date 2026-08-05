"use client";

import { useState } from "react";
import { Lead, LeadStage, useAuth, ROLE_LABELS, MOCK_LEADS, getDefaultCountryCode } from "@apex/sales-crm-shared";
import CountryCodeSelect from "@/components/sales-crm/ui/CountryCodeSelect";
import CompanyAutocomplete from "@/components/sales-crm/ui/CompanyAutocomplete";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface LeadCreateProps {
  onCancel: () => void;
  onSave: (lead: Lead) => void;
  existingLeads: Lead[];
}

const LEAD_SOURCE_OPTIONS = [
  "Meta Ad's",
  "Incoming",
  "Self Source",
  "Reference",
  "Google Ad's",
  "LinkedIn Paid Ad's",
];
const SERVICE_INTEREST_OPTIONS = [
  "Corporate training",
  "Content Development",
  "E-Learning Solution",
  "AI and Automation service",
  "Other",
];
const GROUP_OWNER_OPTIONS = ["Sales Delivery", "Corporate Training"];
const LOCATION_SUGGESTIONS = Array.from(new Set([
  ...MOCK_LEADS.map((lead) => lead.location),
  "Bengaluru, India",
  "Mumbai, India",
  "Pune, India",
  "Delhi, India",
  "Hyderabad, India",
  "Chennai, India",
  "Gurugram, India",
])).sort();

const normalizePhone = (value?: string) => value ? value.replace(/\D/g, "") : "";
const lastTen = (value: string) => value.length >= 10 ? value.slice(-10) : value;
const phoneKeys = (value?: string) => {
  const normalized = normalizePhone(value);
  return normalized ? [normalized, lastTen(normalized)] : [];
};
const sanitizeDigits = (value: string) => value.replace(/\D/g, "").slice(0, 10);

export default function LeadCreate({ onCancel, onSave, existingLeads }: LeadCreateProps) {
  const { user } = useAuth();
  const [companyInfo, setCompanyInfo] = useState<{ companyName: string, companyId?: string }>({ companyName: "" });
  const [poc, setPoc] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState(getDefaultCountryCode());
  const [phone, setPhone] = useState("");
  const [alternateCountryCode, setAlternateCountryCode] = useState(getDefaultCountryCode());
  const [alternateNumber, setAlternateNumber] = useState("");

  const [linkedin, setLinkedin] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [headquarters, setHeadquarters] = useState("");
  const [locations, setLocations] = useState("");
  const [designation, setDesignation] = useState("");
  const [website, setWebsite] = useState("");
  const [department, setDepartment] = useState("");
  const [industry, setIndustry] = useState("");
  const [technologies, setTechnologies] = useState("");
  const [groupOwner, setGroupOwner] = useState("");
  const [serviceInterest, setServiceInterest] = useState("");
  const [otherServiceInterest, setOtherServiceInterest] = useState("");
  const [leadSources, setLeadSources] = useState<string[]>([]);
  const [isSourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [branch, setBranch] = useState("");
  const [initialNotes, setInitialNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const leadStage: LeadStage = "Created";
  const fullPhone = phone ? `${phoneCountryCode}${phone}` : "";
  const fullAlternateNumber = alternateNumber ? `${alternateCountryCode}${alternateNumber}` : "";
  const ownerDisplay = user ? `${user.name} (${ROLE_LABELS[user.role]})` : "";

  const reminderClass = (value: string | string[]) => {
    const isMissing = Array.isArray(value) ? value.length === 0 : !value.trim();
    return isMissing ? styles["lead-input-reminder"] : "";
  };

  const handleSourceChange = (value: string) => {
    setLeadSources((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
    );
  };

  const handleCreate = () => {
    if (!user) {
      setErrorMsg("Authentication error: No valid user session found.");
      return;
    }

    if (!companyInfo.companyName.trim() || !poc.trim() || !email.trim() || !phone.trim()) {
      setErrorMsg("Company name, POC, Email, and Phone are compulsory.");
      return;
    }

    if (phone.length !== 10) {
      setErrorMsg("Phone number must contain exactly 10 digits.");
      return;
    }

    if (alternateNumber && alternateNumber.length !== 10) {
      setErrorMsg("Alternate phone number must contain exactly 10 digits.");
      return;
    }

    const submittedNumbers = [...phoneKeys(fullPhone), ...phoneKeys(fullAlternateNumber)];
    const duplicateLead = existingLeads.find((lead) => {
      const existingNumbers = [...phoneKeys(lead.phone), ...phoneKeys(lead.alternateNumber)];
      return submittedNumbers.some((submittedNumber) => existingNumbers.includes(submittedNumber));
    });

    if (duplicateLead) {
      setErrorMsg(`Repeated lead found: ${duplicateLead.company}. Phone or alternate phone already exists.`);
      return;
    }

    if (!companyInfo.companyId) {
        setErrorMsg("Please select or add a valid company from the suggestions.");
        return;
    }

    setErrorMsg("");

    const generateDeterministicId = (prefix: string) => {
      const sanitizedCompany = companyInfo.companyName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 5) || "lead";
      const strVal = `${companyInfo.companyName}|${poc}|${email}|${fullPhone}`;
      let hash = 0;
      for (let i = 0; i < strVal.length; i++) {
        hash = (hash << 5) - hash + strVal.charCodeAt(i);
        hash |= 0;
      }
      return `${prefix}-${sanitizedCompany}-${Math.abs(hash)}`;
    };

    const finalServiceInterest = serviceInterest === "Other" ? otherServiceInterest : serviceInterest;

    const newLead: Lead = {
      id: generateDeterministicId("l"),
      leadOwner: user.id,
      company: companyInfo.companyName.trim(),
      companyId: companyInfo.companyId,
      poc: poc.trim(),
      email: email.trim(),
      phone: fullPhone,
      linkedin: linkedin.trim() || undefined,
      companySize: companySize.trim() || undefined,
      headquarters: headquarters.trim() || undefined,
      location: locations.trim(),
      designation: designation.trim(),
      website: website.trim() || undefined,
      department: department.trim() || undefined,
      industry: industry.trim() || undefined,
      technologies: technologies.split(",").map((technology) => technology.trim()).filter(Boolean),
      groupOwner: groupOwner || undefined,
      serviceInterest: finalServiceInterest?.trim() || undefined,
      leadSource: leadSources.join(", "),
      priority: "Medium",
      initialNotes: initialNotes.trim() || undefined,
      gender: gender.trim() || undefined,
      age: age ? parseInt(age, 10) : undefined,
      alternateNumber: fullAlternateNumber || undefined,
      branch: branch.trim() || undefined,
      leadStage,
      activities: [{
        id: generateDeterministicId("a"),
        dateTime: new Date().toISOString(),
        activityType: "Created",
        comment: initialNotes.trim() || "New lead created.",
        stage: leadStage,
        createdBy: user.id,
      }],
      followups: [],
      requirements: [],
      deals: [],
    };

    onSave(newLead);
  };

  return (
    <div className={`${ui["ui-card"]} ${styles["lead-create-card"]}`}>
      <div className={ui["ui-card-header"]}>
        <div className="ui-flex-center ui-gap-3">
          <span className={`${ui["ui-badge"]} ${ui["ui-badge-primary"]}`}>Lead entry</span>
          <h2 className={`${ui["ui-card-title"]} ui-text-lg`}>Create New Lead</h2>
        </div>
      </div>
      <div className={ui["ui-card-body"]}>
        {errorMsg && (
          <div className={`${ui["ui-notice"]} ${ui["ui-notice-error"]}`}>
            {errorMsg}
          </div>
        )}

        <datalist id="lead-location-suggestions">
          {LOCATION_SUGGESTIONS.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>

        <div className={styles["lead-create-grid"]}>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Owner</label>
            <input className={ui["ui-input"]} disabled value={ownerDisplay} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Company name *</label>
            <CompanyAutocomplete value={companyInfo} onChange={setCompanyInfo} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>POC *</label>
            <input className={ui["ui-input"]} value={poc} onChange={(e) => setPoc(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Email *</label>
            <input className={ui["ui-input"]} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Phone *</label>
            <div className={styles["lead-phone-control"]}>
              <CountryCodeSelect
                value={phoneCountryCode}
                onChange={setPhoneCountryCode}
              />
              <input className={ui["ui-input"]} inputMode="numeric" value={phone} onChange={(e) => setPhone(sanitizeDigits(e.target.value))} placeholder="10 digit number" />
            </div>
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>LinkedIn</label>
            <input className={`${ui["ui-input"]} ${reminderClass(linkedin)}`} value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Company size</label>
            <input className={`${ui["ui-input"]} ${reminderClass(companySize)}`} value={companySize} onChange={(e) => setCompanySize(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Headquarters</label>
            <input className={`${ui["ui-input"]} ${reminderClass(headquarters)}`} value={headquarters} onChange={(e) => setHeadquarters(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Location</label>
            <input className={`${ui["ui-input"]} ${reminderClass(locations)}`} list="lead-location-suggestions" value={locations} onChange={(e) => setLocations(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Designation</label>
            <input className={`${ui["ui-input"]} ${reminderClass(designation)}`} value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Website</label>
            <input className={`${ui["ui-input"]} ${reminderClass(website)}`} value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Department</label>
            <input className={ui["ui-input"]} value={department} onChange={(e) => setDepartment(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Industry</label>
            <input className={ui["ui-input"]} value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Technologies (comma separated)</label>
            <input className={ui["ui-input"]} value={technologies} onChange={(e) => setTechnologies(e.target.value)} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Group Owner</label>
            <select className={ui["ui-select"]} value={groupOwner} onChange={(e) => setGroupOwner(e.target.value)}>
              <option value="">Select group owner</option>
              {GROUP_OWNER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Service Interest</label>
            <select className={ui["ui-select"]} value={serviceInterest} onChange={(e) => setServiceInterest(e.target.value)}>
              <option value="">Select service interest</option>
              {SERVICE_INTEREST_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          {serviceInterest === "Other" && (
            <div className={ui["ui-form-group"]}>
              <label className={ui["ui-label"]}>Other Service Interest</label>
              <input className={ui["ui-input"]} value={otherServiceInterest} onChange={(e) => setOtherServiceInterest(e.target.value)} />
            </div>
          )}
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Lead Source</label>
            <div className={styles["lead-multiselect"]}>
              <button
                type="button"
                className={`${styles["lead-multiselect-trigger"]} ${reminderClass(leadSources)}`}
                onClick={() => setSourceMenuOpen((current) => !current)}
                aria-expanded={isSourceMenuOpen}
              >
                <span className={leadSources.length ? styles["lead-multiselect-value"] : styles["lead-multiselect-placeholder"]}>
                  {leadSources.length ? leadSources.join(", ") : "Select lead source"}
                </span>
                <span className={styles["lead-multiselect-chevron"]}>v</span>
              </button>
              {isSourceMenuOpen && (
                <div className={styles["lead-multiselect-menu"]}>
                  {LEAD_SOURCE_OPTIONS.map((option) => (
                    <label className={styles["lead-checkbox-option"]} key={option}>
                      <input
                        type="checkbox"
                        checked={leadSources.includes(option)}
                        onChange={() => handleSourceChange(option)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Lead Stage</label>
            <input className={ui["ui-input"]} disabled value={leadStage} />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Gender</label>
            <input className={ui["ui-input"]} value={gender} onChange={(e) => setGender(e.target.value)} placeholder="e.g. Female" />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Age</label>
            <input type="number" className={ui["ui-input"]} value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 30" />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Alternate No</label>
            <div className={styles["lead-phone-control"]}>
              <CountryCodeSelect
                value={alternateCountryCode}
                onChange={setAlternateCountryCode}
              />
              <input className={ui["ui-input"]} inputMode="numeric" value={alternateNumber} onChange={(e) => setAlternateNumber(sanitizeDigits(e.target.value))} placeholder="10 digit number" />
            </div>
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Branch</label>
            <input className={ui["ui-input"]} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. North America" />
          </div>

          <div className={`${ui["ui-form-group"]} ${styles["lead-create-full-span"]}`}>
            <label className={ui["ui-label"]}>Initial Notes</label>
            <textarea className={ui["ui-input"]} rows={3} value={initialNotes} onChange={(e) => setInitialNotes(e.target.value)} />
          </div>
        </div>
        <div className={ui["ui-action-row"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onCancel}>Back to Leads</button>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleCreate}>Create Lead</button>
        </div>
      </div>
    </div>
  );
}
